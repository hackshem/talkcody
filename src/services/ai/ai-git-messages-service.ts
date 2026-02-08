import { logger } from '@/lib/logger';
import { llmClient } from '@/services/llm/llm-client';
import type { GitMessageContext, GitMessageResult } from '@/services/llm/types';

class AIGitMessagesService {
  async generateCommitMessage(context: GitMessageContext): Promise<GitMessageResult | null> {
    try {
      logger.info('generateCommitMessage diffText length', context.diffText?.length ?? 0);

      if (!context.diffText || context.diffText.trim().length === 0) {
        logger.error('No diff text provided for commit message generation');
        return null;
      }

      const result = await llmClient.generateCommitMessage(context);

      if (result.message) {
        logger.info('AI Git Message result:', result.message);
        return result;
      }

      return null;
    } catch (error) {
      logger.error('AI git message generation error:', error);
      return null;
    }
  }
}

export const aiGitMessagesService = new AIGitMessagesService();
