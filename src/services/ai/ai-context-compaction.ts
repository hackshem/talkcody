import { logger } from '@/lib/logger';
import { GEMINI_25_FLASH_LITE, getContextLength } from '@/providers/config/model-config';
import { useProviderStore } from '@/providers/stores/provider-store';
import { buildPromptRequest, llmClient } from '@/services/llm/llm-client';

export interface ContextCompactionResult {
  compressedSummary: string;
}

class AIContextCompactionService {
  private readonly COMPRESSION_TIMEOUT_MS = 300000;

  private static readonly COMPRESSION_PROMPT =
    `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points.

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Pay special attention to the most recent messages and include full code snippets where applicable.
4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention to specific user feedback.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages that are not tool results. These are critical for understanding the users' feedback and changing intent.
7. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.
8. Current Work: Describe in detail precisely what was being worked on immediately before this summary request.

Please be comprehensive and technical in your summary. Include specific file paths, function names, error messages, and code patterns that would be essential for maintaining context.`;

  /**
   * Compresses conversation history using AI.
   *
   * @param conversationHistory - The conversation history to compress (text format)
   * @param model - Optional model identifier to use for compression
   * @param abortSignal - Optional abort signal for cancellation
   * @returns Promise that resolves to the compressed summary text
   */
  async compactContext(
    conversationHistory: string,
    model?: string,
    abortSignal?: AbortSignal
  ): Promise<string> {
    try {
      logger.info('Starting AI context compaction');
      const startTime = performance.now();

      if (!conversationHistory || conversationHistory.trim().length === 0) {
        logger.error('No conversation history provided for compaction');
        throw new Error('Conversation history is required for compaction');
      }

      // Get available model for compression
      const availableModel = this.getAvailableModelForCompression(model || GEMINI_25_FLASH_LITE);

      if (!availableModel) {
        throw new Error(
          'No available model for compression. Please configure an API key in settings.'
        );
      }

      logger.info('Using model for compression:', availableModel);

      // Prepare the prompt
      const prompt = `${AIContextCompactionService.COMPRESSION_PROMPT}\n\nCONVERSATION HISTORY TO SUMMARIZE:\n${conversationHistory}\n\nPlease provide a comprehensive structured summary following the 8-section format above.`;

      // Use streamText to perform compression
      const request = buildPromptRequest(availableModel, prompt);
      const { events } = await llmClient.streamText(request, abortSignal);

      let compressedSummary = '';
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Compression timeout after ${this.COMPRESSION_TIMEOUT_MS}ms`));
        }, this.COMPRESSION_TIMEOUT_MS);
      });

      try {
        await Promise.race([
          (async () => {
            for await (const delta of events) {
              if (delta.type === 'text-delta') {
                compressedSummary += delta.text;
              }
            }
          })(),
          timeoutPromise,
        ]);
      } catch (error) {
        if (error instanceof Error && error.message.includes('timeout')) {
          logger.error('Compression timeout', error);
          throw error;
        }
        throw error;
      }

      const endTime = performance.now();
      const totalTime = endTime - startTime;

      logger.info(`Context compaction completed - Total time: ${totalTime.toFixed(2)}ms`);
      logger.info(
        `Compressed summary length: ${compressedSummary.length} characters (from ${conversationHistory.length})`
      );

      return compressedSummary.trim();
    } catch (error) {
      logger.error('AI context compaction error:', error);
      throw error;
    }
  }

  /**
   * Gets the best available model for compression.
   * Falls back to the cheapest model with the largest context window if preferred model is unavailable.
   */
  private getAvailableModelForCompression(preferredModel: string): string | null {
    if (useProviderStore.getState().isModelAvailable(preferredModel)) {
      return preferredModel;
    }

    const models = useProviderStore.getState().availableModels;
    if (models.length === 0) {
      return null;
    }

    const modelsWithPricing = models.filter((m) => m.inputPricing !== undefined);
    if (modelsWithPricing.length === 0) {
      return null;
    }

    const sorted = modelsWithPricing.sort((a, b) => {
      const contextA = getContextLength(a.key);
      const contextB = getContextLength(b.key);

      if (contextA !== contextB) {
        return contextB - contextA;
      }

      const priceA = Number.parseFloat(a.inputPricing ?? 'Infinity') || 0;
      const priceB = Number.parseFloat(b.inputPricing ?? 'Infinity') || 0;
      return priceA - priceB;
    });

    const fallback = sorted[0];
    if (fallback) {
      logger.info(
        `[Compression] Preferred model ${preferredModel} not available, using fallback: ${fallback.key}@${fallback.provider} (context: ${getContextLength(fallback.key)}, price: ${fallback.inputPricing})`
      );
      return `${fallback.key}@${fallback.provider}`;
    }

    return null;
  }
}

export const aiContextCompactionService = new AIContextCompactionService();
