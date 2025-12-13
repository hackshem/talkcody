import { z } from 'zod';
import { GenericToolResult } from '@/components/tools/generic-tool-result';
import { WriteFileToolDoing } from '@/components/tools/write-file-tool-doing';
import { createTool } from '@/lib/create-tool';
import { logger } from '@/lib/logger';
import { createPathSecurityError, isPathWithinProjectDirectory } from '@/lib/utils/path-security';
import { ConversationManager } from '@/services/conversation-manager';
import { notificationService } from '@/services/notification-service';
import { repositoryService } from '@/services/repository-service';
import { normalizeFilePath } from '@/services/repository-utils';
import { getValidatedWorkspaceRoot } from '@/services/workspace-root-service';
import {
  type FileEditReviewResult,
  type PendingEdit,
  useEditReviewStore,
} from '@/stores/edit-review-store';
import { useFileChangesStore } from '@/stores/file-changes-store';
import { settingsManager } from '@/stores/settings-store';
import type { TaskSettings } from '@/types';
import { normalizeString } from '@/utils/text-replacement';

export const writeFile = createTool({
  name: 'writeFile',
  description: `Use this tool to write content to a file.

This tool will create or overwrite a file with the provided content. It will automatically create directories if they don't exist. It's useful for creating new files or updating existing files in the project.

The file path should be an absolute path.`,
  inputSchema: z.object({
    file_path: z.string().describe('The absolute path of file you want to write'),
    content: z.string().describe('The content to write to the file'),
  }),
  canConcurrent: false,
  execute: async ({ file_path, content, review_mode = true }) => {
    try {
      const rootPath = await getValidatedWorkspaceRoot();
      if (!rootPath) {
        return {
          success: false,
          file_path,
          message: 'Project root path is not set.',
        };
      }
      file_path = await normalizeFilePath(rootPath, file_path);

      // Security check: Ensure file path is within the current project directory
      const isPathSecure = await isPathWithinProjectDirectory(file_path, rootPath);
      if (!isPathSecure) {
        const securityError = createPathSecurityError(file_path, rootPath);
        logger.error(`writeFile: Security violation - ${securityError}`);
        return {
          success: false,
          file_path,
          message: securityError,
        };
      }

      logger.info('Writing file:', file_path);

      // Normalize the new content
      const normalizedContent = normalizeString(content);

      // Check if file exists to determine if this is a create or overwrite operation
      let originalContent = '';
      let fileExists = false;
      try {
        originalContent = await repositoryService.readFileWithCache(file_path);
        originalContent = normalizeString(originalContent);
        fileExists = true;
      } catch {
        // File doesn't exist - this is a create operation
        fileExists = false;
      }

      // Check if auto-approve is enabled for this conversation
      const conversationId = settingsManager.getCurrentConversationId();
      const settingsJson = await ConversationManager.getConversationSettings(conversationId);

      if (settingsJson) {
        try {
          const settings: TaskSettings = JSON.parse(settingsJson);
          if (settings.autoApproveEdits === true) {
            // Auto-approve is enabled, directly write the file
            await repositoryService.writeFile(file_path, normalizedContent);
            const successMessage = fileExists
              ? `Successfully overwrote file: ${file_path} [Auto-approved]`
              : `Successfully created file: ${file_path} [Auto-approved]`;
            logger.info(successMessage);

            // Track the file change (use 'edit' if file exists, 'write' if new)
            useFileChangesStore
              .getState()
              .addChange(
                conversationId,
                file_path,
                fileExists ? 'edit' : 'write',
                originalContent,
                normalizedContent
              );

            return {
              success: true,
              message: successMessage,
              type: 'success',
            };
          }
        } catch (error) {
          logger.error('Failed to parse conversation settings:', error);
          // Continue to review mode if settings parsing fails
        }
      }

      // Handle review mode internally
      if (review_mode) {
        const editId = `write_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const pendingEdit: PendingEdit = {
          id: editId,
          filePath: file_path,
          originalContent,
          newContent: normalizedContent,
          operation: 'write',
          timestamp: Date.now(),
        };

        // Create callbacks for approval/rejection/allowAll
        const callbacks = {
          onApprove: async () => {
            await repositoryService.writeFile(file_path, normalizedContent);
            const message = fileExists
              ? `Successfully overwrote file: ${file_path}`
              : `Successfully created file: ${file_path}`;
            logger.info(message);

            // Track the file change (use 'edit' if file exists, 'write' if new)
            useFileChangesStore
              .getState()
              .addChange(
                conversationId,
                file_path,
                fileExists ? 'edit' : 'write',
                originalContent,
                normalizedContent
              );

            return { success: true, message };
          },
          onReject: async (feedback: string) => {
            logger.info(`Write rejected for ${file_path}: ${feedback}`);
            return {
              success: true,
              message: `Write rejected. Feedback: ${feedback}`,
              feedback,
            };
          },
          onAllowAll: async () => {
            // 1. Update conversation settings to enable auto-approve
            const newSettings: TaskSettings = { autoApproveEdits: true };
            await ConversationManager.updateConversationSettings(
              conversationId,
              JSON.stringify(newSettings)
            );
            logger.info(`Auto-approve enabled for conversation ${conversationId}`);

            // 2. Approve current write
            await repositoryService.writeFile(file_path, normalizedContent);
            const message = fileExists
              ? `Successfully overwrote file: ${file_path}. All future edits in this conversation will be auto-approved.`
              : `Successfully created file: ${file_path}. All future edits in this conversation will be auto-approved.`;
            logger.info(message);

            // Track the file change (use 'edit' if file exists, 'write' if new)
            useFileChangesStore
              .getState()
              .addChange(
                conversationId,
                file_path,
                fileExists ? 'edit' : 'write',
                originalContent,
                normalizedContent
              );

            return { success: true, message };
          },
        };

        // Handle review inline using the store
        try {
          // Send notification if window is not focused
          await notificationService.notifyReviewRequired();

          // Create a Promise that will be resolved when user reviews the write
          const reviewResult = await new Promise<FileEditReviewResult>((resolve) => {
            logger.info('[WriteFileTool] Creating Promise and setting pending edit in store');

            // Store the pending edit, callbacks, and resolver in the store
            useEditReviewStore.getState().setPendingEdit(editId, pendingEdit, callbacks, resolve);
          });

          // Type guard to ensure reviewResult has the expected structure
          if (
            typeof reviewResult === 'object' &&
            reviewResult !== null &&
            'success' in reviewResult
          ) {
            // Check the result format from FileEditReviewCard
            if (reviewResult.success && reviewResult.approved) {
              // User approved - return success
              return {
                success: true,
                message:
                  reviewResult.message ||
                  (fileExists
                    ? `Successfully overwrote file: ${file_path}`
                    : `Successfully created file: ${file_path}`),
                type: 'success',
              };
            }
            // User rejected with feedback
            const feedback = reviewResult.feedback || 'Write rejected by user';
            logger.info(`Write rejected for ${file_path}: ${feedback}`);

            return {
              success: true,
              message: `Write rejected. Feedback: ${feedback}`,
              feedback,
              type: 'user_feedback',
            };
          }
          // Handle unexpected review result format
          logger.error('Unexpected review result format:', reviewResult);
          return {
            success: false,
            message: 'Unexpected review result format',
            type: 'error',
          };
        } catch (error) {
          logger.error('Error in review process:', error);
          return {
            success: false,
            message: `Review process failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            type: 'error',
          };
        }
      }

      // Direct mode (no review)
      await repositoryService.writeFile(file_path, normalizedContent);
      logger.info(`writeFile: Wrote to file at path: ${file_path}`);

      // Track the file change (use 'edit' if file exists, 'write' if new)
      useFileChangesStore
        .getState()
        .addChange(
          conversationId,
          file_path,
          fileExists ? 'edit' : 'write',
          originalContent,
          normalizedContent
        );

      return {
        success: true,
        file_path,
        message: `Successfully wrote to file: ${file_path}`,
      };
    } catch (error) {
      logger.error('Error writing file:', error);
      return {
        success: false,
        file_path,
        message: `Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
  renderToolDoing: ({ file_path }) => {
    // Use the responsive wrapper component that subscribes to the store
    return <WriteFileToolDoing file_path={file_path} />;
  },
  renderToolResult: (result, { file_path } = {}) => (
    <GenericToolResult
      success={result?.success ?? false}
      operation="write"
      filePath={file_path}
      message={result?.message}
      error={result?.success ? undefined : result?.message}
    />
  ),
});
