import { logger } from '@/lib/logger';
import { llmClient } from '@/services/llm/llm-client';
import type { TitleGenerationResult } from '@/services/llm/types';
import { settingsManager } from '@/stores/settings-store';

class AITaskTitleService {
  async generateTitle(userInput: string): Promise<TitleGenerationResult | null> {
    try {
      if (!userInput || userInput.trim().length === 0) {
        logger.error('No user input provided for title generation');
        return null;
      }

      const language = settingsManager.getSync('language');

      const result = await llmClient.generateTitle({
        userInput,
        language: language === 'zh' ? 'zh' : 'en',
      });

      if (result.title) {
        logger.info('AI generated title:', result.title);
        return result;
      }

      return null;
    } catch (error) {
      logger.error('AI title generation error:', error);
      return null;
    }
  }
}

export const aiTaskTitleService = new AITaskTitleService();
