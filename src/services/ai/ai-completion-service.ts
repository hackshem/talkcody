import { logger } from '@/lib/logger';
import { CODE_STARL } from '@/providers/config/model-config';
import { buildPromptRequest, llmClient } from '@/services/llm/llm-client';

export interface CompletionContext {
  fileContent: string;
  cursorPosition: number;
  fileName: string;
  language: string;
}

export interface CompletionResult {
  completion: string;
  range?: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
}

class AICompletionService {
  async getCompletion(context: CompletionContext): Promise<CompletionResult | null> {
    try {
      logger.info('getCompletion context', {
        fileName: context.fileName,
        language: context.language,
        cursorPosition: context.cursorPosition,
        contentLength: context.fileContent.length,
      });
      const startTime = performance.now();
      let firstDeltaTime: number | null = null;
      let isFirstDelta = true;
      let deltaCount = 0;

      const { fileContent, cursorPosition, fileName, language } = context;

      // Extract text before and after cursor for context
      const beforeCursor = fileContent.substring(0, cursorPosition);
      const afterCursor = fileContent.substring(cursorPosition);

      // Get the current line and context
      const lines = beforeCursor.split('\n');
      const currentLine = lines[lines.length - 1];
      const previousLines = lines.slice(-10).join('\n'); // Last 10 lines for context

      // Create prompt for AI completion
      const prompt = `You are an AI code completion assistant. Complete the following ${language} code.

File: ${fileName}
Context (previous lines):
\`\`\`${language}
${previousLines}
\`\`\`

Current incomplete line: "${currentLine}"

After cursor:
\`\`\`${language}
${afterCursor.split('\n').slice(0, 5).join('\n')}
\`\`\`

Provide ONLY the completion text that should be inserted at the cursor position. Do not include the existing text or explanations.
Response should be plain text without markdown formatting.
Keep the completion concise and relevant to the current context.`;

      const request = buildPromptRequest(CODE_STARL, prompt);
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
          logger.info(`Completion time to first delta: ${timeToFirstDelta.toFixed(2)}ms`);
          isFirstDelta = false;
        }

        fullText += delta.text;
      }

      const endTime = performance.now();
      const totalStreamTime = endTime - startTime;

      logger.info(
        `Completion stream completed - Total time: ${totalStreamTime.toFixed(2)}ms, Deltas: ${deltaCount}`
      );

      const completion = fullText.trim();
      logger.info('AI Completion result:', completion);

      if (completion) {
        return {
          completion,
        };
      }

      return null;
    } catch (error) {
      logger.error('AI completion error:', error);
      return null;
    }
  }
}

export const aiCompletionService = new AICompletionService();
