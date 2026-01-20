import { exists } from '@tauri-apps/plugin-fs';
import { z } from 'zod';
import { GenericToolDoing } from '@/components/tools/generic-tool-doing';
import { GenericToolResult } from '@/components/tools/generic-tool-result';
import { createTool } from '@/lib/create-tool';
import { logger } from '@/lib/logger';
import { getLocale, type SupportedLocale } from '@/locales';
import { lspConnectionManager } from '@/services/lsp/lsp-connection-manager';
import type {
  CallHierarchyIncomingCall,
  CallHierarchyOutgoingCall,
} from '@/services/lsp/lsp-protocol';
import {
  findWorkspaceRoot,
  getLanguageDisplayName,
  getLanguageIdForPath,
  getLspLanguageIdForPath,
  getServerConfig,
  hasLspSupport,
} from '@/services/lsp/lsp-servers';
import { lspService } from '@/services/lsp/lsp-service';
import { repositoryService } from '@/services/repository-service';
import { getRelativePath, normalizeFilePath } from '@/services/repository-utils';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';
import { useSettingsStore } from '@/stores/settings-store';

const operations = [
  'goToDefinition',
  'findReferences',
  'hover',
  'documentSymbol',
  'workspaceSymbol',
  'goToImplementation',
  'prepareCallHierarchy',
  'incomingCalls',
  'outgoingCalls',
] as const;

interface LspToolResult {
  success: boolean;
  message: string;
  data?: unknown;
}

function getTranslations() {
  const language = (useSettingsStore.getState().language || 'en') as SupportedLocale;
  return getLocale(language).ToolMessages.Lsp;
}

function isEmptyResult(result: unknown): boolean {
  if (result === null || result === undefined) {
    return true;
  }
  if (Array.isArray(result)) {
    return result.length === 0;
  }
  return false;
}

async function resolveCallHierarchy(
  serverId: string,
  filePath: string,
  line: number,
  character: number,
  direction: 'incoming' | 'outgoing'
): Promise<CallHierarchyIncomingCall[] | CallHierarchyOutgoingCall[] | null> {
  const items = await lspService.prepareCallHierarchy(serverId, filePath, line, character);
  if (!items || items.length === 0) {
    return [];
  }

  const results = await Promise.all(
    items.map(async (item) => {
      if (direction === 'incoming') {
        return lspService.incomingCalls(serverId, item);
      }
      return lspService.outgoingCalls(serverId, item);
    })
  );

  const flattened = results
    .flat()
    .filter((entry): entry is CallHierarchyIncomingCall | CallHierarchyOutgoingCall => !!entry);

  if (direction === 'incoming') {
    return flattened.filter((entry): entry is CallHierarchyIncomingCall => 'from' in entry);
  }

  return flattened.filter((entry): entry is CallHierarchyOutgoingCall => 'to' in entry);
}

export const lspTool = createTool({
  name: 'lsp',
  description: `Perform Language Server Protocol (LSP) operations like go-to-definition, references, hover, and symbols.

Provide a file path and a 1-based line/character position as shown in editors.`,
  inputSchema: z.object({
    operation: z.enum(operations).describe('The LSP operation to perform'),
    filePath: z.string().describe('The absolute or relative path to the file'),
    line: z.number().int().min(1).describe('The line number (1-based, as shown in editors)'),
    character: z
      .number()
      .int()
      .min(1)
      .describe('The character offset (1-based, as shown in editors)'),
  }),
  canConcurrent: true,
  execute: async ({ operation, filePath, line, character }, context): Promise<LspToolResult> => {
    let serverId: string | null = null;
    let shouldDecrement = false;
    let didOpenDocument = false;
    let resolvedPath: string | null = null;
    let language: string | null = null;
    let workspaceRoot: string | null = null;

    const t = getTranslations();

    try {
      const rootPath = await getEffectiveWorkspaceRoot(context.taskId);
      if (!rootPath) {
        return {
          success: false,
          message: t.projectRootNotSet,
        };
      }

      resolvedPath = await normalizeFilePath(rootPath, filePath);
      const fileExists = await exists(resolvedPath);
      if (!fileExists) {
        return {
          success: false,
          message: t.fileNotFound(resolvedPath),
        };
      }

      language = getLanguageIdForPath(resolvedPath);
      if (!language || !hasLspSupport(language)) {
        return {
          success: false,
          message: t.noLspSupport,
        };
      }

      await lspService.init();

      const status = await lspService.getServerStatus(language);
      if (!status.available) {
        if (status.canDownload) {
          return {
            success: false,
            message: t.serverNotInstalled(getLanguageDisplayName(language)),
          };
        }
        const config = getServerConfig(language);
        return {
          success: false,
          message: t.serverNotAvailable(config?.command || 'unknown'),
        };
      }

      workspaceRoot = await findWorkspaceRoot(resolvedPath, language, rootPath);

      const directConnection = lspConnectionManager.getConnection(resolvedPath);
      if (directConnection) {
        serverId = directConnection.serverId;
      } else {
        serverId = await lspService.startServer(language, workspaceRoot);
        shouldDecrement = true;
      }

      if (!directConnection) {
        const lspLanguageId = getLspLanguageIdForPath(resolvedPath);
        if (!lspLanguageId) {
          return {
            success: false,
            message: t.languageIdMissing,
          };
        }
        const content = await repositoryService.readFileWithCache(resolvedPath);
        await lspService.openDocument(serverId, resolvedPath, lspLanguageId, content);
        didOpenDocument = true;
      }

      const lspLine = line - 1;
      const lspCharacter = character - 1;

      let data: unknown;
      switch (operation) {
        case 'goToDefinition':
          data = await lspService.definition(serverId, resolvedPath, lspLine, lspCharacter);
          break;
        case 'findReferences':
          data = await lspService.references(serverId, resolvedPath, lspLine, lspCharacter);
          break;
        case 'hover':
          data = await lspService.hover(serverId, resolvedPath, lspLine, lspCharacter);
          break;
        case 'documentSymbol':
          data = await lspService.documentSymbol(serverId, resolvedPath);
          break;
        case 'workspaceSymbol':
          data = await lspService.workspaceSymbol(serverId, '');
          break;
        case 'goToImplementation':
          data = await lspService.implementation(serverId, resolvedPath, lspLine, lspCharacter);
          break;
        case 'prepareCallHierarchy':
          data = await lspService.prepareCallHierarchy(
            serverId,
            resolvedPath,
            lspLine,
            lspCharacter
          );
          break;
        case 'incomingCalls':
          data = await resolveCallHierarchy(
            serverId,
            resolvedPath,
            lspLine,
            lspCharacter,
            'incoming'
          );
          break;
        case 'outgoingCalls':
          data = await resolveCallHierarchy(
            serverId,
            resolvedPath,
            lspLine,
            lspCharacter,
            'outgoing'
          );
          break;
        default:
          return {
            success: false,
            message: t.operationNotSupported(operation),
          };
      }

      const relativePath = getRelativePath(resolvedPath, rootPath);
      const locationLabel = `${relativePath}:${line}:${character}`;
      if (isEmptyResult(data)) {
        return {
          success: false,
          message: t.noResults(operation),
          data,
        };
      }

      return {
        success: true,
        message: t.success(operation, locationLabel),
        data,
      };
    } catch (error) {
      logger.error('[LSP Tool] Failed to execute operation:', error);
      return {
        success: false,
        message: t.failed(operation, error instanceof Error ? error.message : t.unknownError),
      };
    } finally {
      try {
        if (serverId && didOpenDocument && resolvedPath) {
          await lspService.closeDocument(serverId, resolvedPath);
        }
      } catch (error) {
        logger.warn('[LSP Tool] Failed to close document:', error);
      }

      if (serverId && shouldDecrement) {
        lspService.decrementRefCount(serverId);
      }
    }
  },
  renderToolDoing: ({ operation, filePath, line, character }) => {
    const details = `Operation: ${operation}\nLocation: ${line}:${character}`;
    return <GenericToolDoing operation="read" target={filePath} details={details} />;
  },
  renderToolResult: (result) => {
    if (!result?.success) {
      return <GenericToolResult success={false} message={result?.message} />;
    }

    const data = result?.data;
    if (data === undefined || data === null) {
      return <GenericToolResult success={true} message={result?.message} />;
    }

    return (
      <div className="space-y-3">
        <GenericToolResult success={true} message={result?.message} />
        <div className="border rounded-lg p-3 bg-white dark:bg-gray-900 dark:border-gray-700 w-full overflow-hidden">
          <pre className="bg-gray-50 dark:bg-gray-800 p-3 rounded text-sm overflow-y-auto overflow-x-hidden max-h-96 mt-3 text-gray-800 dark:text-gray-200 font-mono border border-gray-200 dark:border-gray-700 whitespace-pre-wrap break-words">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      </div>
    );
  },
});
