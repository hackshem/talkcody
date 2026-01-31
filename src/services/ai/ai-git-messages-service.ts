import { logger } from '@/lib/logger';
import { GEMINI_25_FLASH_LITE } from '@/providers/config/model-config';
import { useProviderStore } from '@/providers/stores/provider-store';
import { buildPromptRequest, llmClient } from '@/services/llm/llm-client';

export interface GitMessageContext {
  userInput?: string;
  diffText: string;
}

export interface GitMessageResult {
  message: string;
  suggestions?: string[];
}

class AIGitMessagesService {
  async generateCommitMessage(context: GitMessageContext): Promise<GitMessageResult | null> {
    try {
      logger.info('generateCommitMessage diffText length', context.diffText?.length ?? 0);
      const startTime = performance.now();
      let firstDeltaTime: number | null = null;
      let isFirstDelta = true;
      let deltaCount = 0;

      const { userInput, diffText } = context;

      if (!diffText || diffText.trim().length === 0) {
        logger.error('No diff text provided for commit message generation');
        return null;
      }

      const prompt = `You are an AI assistant that generates concise and meaningful git commit messages following conventional commit format.

${userInput ? `User task description: "${userInput}"\n` : ''}
File changes (git diff):
${diffText}

Generate a concise git commit message that follows these guidelines:
1. Use conventional commit format: type(scope): description
2. Types: feat, fix, docs, style, refactor, test, chore
3. Keep the message under 72 characters for the subject line
4. Be specific about what was changed based on the actual diff content
5. Use imperative mood (e.g., "add", "fix", "update")

Examples:
- feat(auth): add user authentication system
- fix(api): resolve data validation error
- docs: update installation instructions
- refactor: simplify user service logic

Provide ONLY the commit message without any explanations or formatting.`;

      // Get the preferred model, fallback to lowest cost available model if not configured
      const preferredModel = GEMINI_25_FLASH_LITE;
      let modelIdentifier = preferredModel;

      // Check if preferred model is available
      if (!useProviderStore.getState().isModelAvailable(preferredModel)) {
        const fallbackModel = useProviderStore.getState().getAvailableModel();
        if (fallbackModel) {
          modelIdentifier = `${fallbackModel.key}@${fallbackModel.provider}`;
          logger.info(
            `[GitMessage] Preferred model ${preferredModel} not available, using fallback: ${modelIdentifier}`
          );
        } else {
          logger.error('No available model for git message generation');
          return null;
        }
      }

      const request = buildPromptRequest(modelIdentifier, prompt);
      const { events } = await llmClient.streamText(request);

      let fullText = '';
      for await (const delta of events) {
        if (delta.type !== 'text-delta') {
          continue;
        }
        deltaCount++;

        if (isFirstDelta) {
          firstDeltaTime = performance.now();
          const timeToFirstDelta = firstDeltaTime - startTime;
          logger.info(
            `Git message generation time to first delta: ${timeToFirstDelta.toFixed(2)}ms`
          );
          isFirstDelta = false;
        }

        fullText += delta.text;
      }

      const endTime = performance.now();
      const totalStreamTime = endTime - startTime;

      logger.info(
        `Git message generation completed - Total time: ${totalStreamTime.toFixed(2)}ms, Deltas: ${deltaCount}`
      );

      const message = fullText.trim();
      logger.info('AI Git Message result:', message);

      if (message) {
        return {
          message,
        };
      }

      return null;
    } catch (error) {
      logger.error('AI git message generation error:', error);
      return null;
    }
  }
}

export const aiGitMessagesService = new AIGitMessagesService();
