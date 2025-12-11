/**
 * LLM Test Helper Functions
 * Based on AI SDK built-in MockLanguageModelV2 and simulateReadableStream
 *
 * Usage example:
 * ```typescript
 * import { createMockLLM, streamScenarios } from '@/test/utils/llm-test-helpers';
 *
 * // Method 1: Use preset scenarios
 * mockStreamText.mockReturnValue(streamScenarios.simpleText('Hello!'));
 *
 * // Method 2: Use MockLanguageModelV2
 * const mockLLM = createMockLLM({ text: 'Response' });
 * ```
 */

import { MockLanguageModelV2, simulateReadableStream } from 'ai/test';

// ============================================
// Type Definitions
// ============================================

export interface StreamChunk {
  type: 'text-delta' | 'tool-call' | 'tool-result' | 'finish' | 'error';
  textDelta?: string;
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  finishReason?: 'stop' | 'tool-calls' | 'error';
  usage?: { promptTokens: number; completionTokens: number };
}

export interface MockLLMOptions {
  /** Streaming response chunk sequence */
  chunks?: StreamChunk[];
  /** Simplified text response */
  text?: string;
  /** Whether to throw an error */
  shouldError?: boolean;
  errorMessage?: string;
  /** Token usage */
  inputTokens?: number;
  outputTokens?: number;
}

export interface ToolCallInput {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

// ============================================
// Core Factory Functions
// ============================================

/**
 * Create MockLanguageModelV2 instance
 * This is a key tool for testing LLMService core flow
 *
 * @example
 * ```typescript
 * const mockLLM = createMockLLM({ text: 'Hello world' });
 * // Or control errors
 * const errorLLM = createMockLLM({ shouldError: true, errorMessage: 'API error' });
 * ```
 */
export function createMockLLM(options: MockLLMOptions = {}): MockLanguageModelV2 {
  const {
    text,
    chunks,
    shouldError = false,
    errorMessage = 'Mock error',
    inputTokens = 100,
    outputTokens = 50,
  } = options;

  if (shouldError) {
    return new MockLanguageModelV2({
      doStream: async () => {
        throw new Error(errorMessage);
      },
      doGenerate: async () => {
        throw new Error(errorMessage);
      },
    });
  }

  // If text is provided, automatically convert to chunks
  const finalChunks = chunks ?? (text ? textToChunks(text) : defaultChunks());

  return new MockLanguageModelV2({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks: finalChunks }),
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
    doGenerate: async () => ({
      rawCall: { rawPrompt: null, rawSettings: {} },
      finishReason: 'stop' as const,
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      text: text ?? 'Mock response',
    }),
  });
}

/**
 * Create return value for vi.mock('ai').streamText
 * This is the main way to mock AI SDK streamText function return value
 *
 * @example
 * ```typescript
 * mockStreamText.mockReturnValue(createStreamTextMock({
 *   textChunks: ['Hello', ' world'],
 *   finishReason: 'stop',
 * }));
 * ```
 */
export function createStreamTextMock(options: {
  textChunks?: string[];
  toolCalls?: ToolCallInput[];
  finishReason?: 'stop' | 'tool-calls' | 'error';
  inputTokens?: number;
  outputTokens?: number;
}) {
  const {
    textChunks = ['Hello, world!'],
    toolCalls = [],
    finishReason = toolCalls.length > 0 ? 'tool-calls' : 'stop',
    inputTokens = 10,
    outputTokens = 20,
  } = options;

  const fullStream = (async function* () {
    yield { type: 'text-start' };

    for (const text of textChunks) {
      yield { type: 'text-delta', text };
    }

    for (const tc of toolCalls) {
      yield { type: 'tool-call', ...tc };
    }

    yield {
      type: 'step-finish',
      finishReason,
      usage: { inputTokens, outputTokens },
    };
  })();

  return {
    fullStream,
    finishReason: Promise.resolve(finishReason),
    response: Promise.resolve(null),
    providerMetadata: Promise.resolve(null),
  };
}

/**
 * Create MockLanguageModelV2 doStream format response
 * For lower-level testing scenarios
 *
 * @example
 * ```typescript
 * const response = createMockStreamResponse({
 *   textChunks: ['Hello', ' world'],
 *   finishReason: 'stop',
 * });
 * ```
 */
export function createMockStreamResponse(options: {
  textChunks?: string[];
  finishReason?: 'stop' | 'tool-calls' | 'error';
  inputTokens?: number;
  outputTokens?: number;
}) {
  const {
    textChunks = ['Hello, world!'],
    finishReason = 'stop',
    inputTokens = 10,
    outputTokens = 20,
  } = options;

  const chunks: StreamChunk[] = [{ type: 'text-delta', textDelta: '' }];

  for (const text of textChunks) {
    chunks.push({ type: 'text-delta', textDelta: text });
  }

  chunks.push({
    type: 'finish',
    finishReason,
    usage: { promptTokens: inputTokens, completionTokens: outputTokens },
  });

  return {
    stream: simulateReadableStream({ chunks }),
    rawCall: { rawPrompt: null, rawSettings: {} },
  };
}

// ============================================
// Preset Scenarios
// ============================================

/**
 * Preset test scenarios
 * Provides common Mock response patterns
 *
 * @example
 * ```typescript
 * // Simple text
 * mockStreamText.mockReturnValue(streamScenarios.simpleText('Hello!'));
 *
 * // Tool call
 * mockStreamText.mockReturnValue(streamScenarios.withToolCall('readFile', { path: '/test.ts' }));
 *
 * // Bug scenario testing
 * mockStreamText.mockReturnValue(streamScenarios.emptyToolCallsBug());
 * ```
 */
export const streamScenarios = {
  /** Simple text response */
  simpleText: (text = 'Hello, world!') => createStreamTextMock({ textChunks: [text] }),

  /** With tool call */
  withToolCall: (toolName: string, args: Record<string, unknown>) =>
    createStreamTextMock({
      textChunks: ['Let me help...'],
      toolCalls: [{ toolCallId: 'tc-1', toolName, args }],
    }),

  /** Multiple tool calls */
  multipleToolCalls: (calls: Array<{ name: string; args: Record<string, unknown> }>) =>
    createStreamTextMock({
      textChunks: ['Processing...'],
      toolCalls: calls.map((c, i) => ({
        toolCallId: `tc-${i}`,
        toolName: c.name,
        args: c.args,
      })),
    }),

  /** Parallel tool calls (no text) */
  parallelToolCalls: (calls: Array<{ name: string; args: Record<string, unknown> }>) =>
    createStreamTextMock({
      textChunks: [],
      toolCalls: calls.map((c, i) => ({
        toolCallId: `tc-${i}`,
        toolName: c.name,
        args: c.args,
      })),
    }),

  /**
   * Empty tool calls Bug scenario
   * finishReason='tool-calls' but no actual tool calls
   * For testing LLMService handling of this edge case
   */
  emptyToolCallsBug: () =>
    createStreamTextMock({
      textChunks: ['Task completed.'],
      finishReason: 'tool-calls',
      // Note: toolCalls is empty
    }),

  /** Stream interruption error */
  streamError: () => ({
    fullStream: (async function* () {
      yield { type: 'text-delta', text: 'Partial ' };
      yield { type: 'error', error: new Error('Stream interrupted') };
    })(),
    finishReason: Promise.resolve('error'),
    response: Promise.resolve(null),
    providerMetadata: Promise.resolve(null),
  }),

  /** Empty response */
  emptyResponse: () =>
    createStreamTextMock({
      textChunks: [],
      inputTokens: 10,
      outputTokens: 0,
    }),

  /** Response with reasoning (for chain-of-thought testing) */
  withReasoning: (reasoning: string, response: string) => ({
    fullStream: (async function* () {
      yield { type: 'reasoning-start' };
      yield { type: 'reasoning', text: reasoning };
      yield { type: 'text-delta', text: response };
      yield {
        type: 'step-finish',
        finishReason: 'stop',
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    })(),
    finishReason: Promise.resolve('stop'),
    response: Promise.resolve(null),
    providerMetadata: Promise.resolve(null),
  }),
};

// ============================================
// Helper Functions
// ============================================

/**
 * Convert text to streaming chunks
 * Every 3 words as one chunk
 */
function textToChunks(text: string): StreamChunk[] {
  const words = text.split(' ');
  const chunks: StreamChunk[] = [];

  for (let i = 0; i < words.length; i += 3) {
    const chunkText = words.slice(i, i + 3).join(' ');
    chunks.push({
      type: 'text-delta',
      textDelta: i + 3 < words.length ? `${chunkText} ` : chunkText,
    });
  }

  chunks.push({
    type: 'finish',
    finishReason: 'stop',
    usage: { promptTokens: 100, completionTokens: 50 },
  });

  return chunks;
}

/**
 * Default chunks sequence
 */
function defaultChunks(): StreamChunk[] {
  return [
    { type: 'text-delta', textDelta: 'Hello, ' },
    { type: 'text-delta', textDelta: 'world!' },
    { type: 'finish', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 5 } },
  ];
}

/**
 * Create compression summary response
 * For MessageCompactor testing
 */
export function createCompressionSummaryResponse(summary?: string) {
  const defaultSummary = `<analysis>
This is an analysis of the conversation history.
</analysis>

1. Primary Request and Intent: User wants to test message compression.
2. Key Technical Concepts: MessageCompactor, streaming, AI SDK integration.
3. Files and Code Sections: src/services/message-compactor.ts was examined.
4. Errors and fixes: No errors encountered.
5. Problem Solving: Testing compression flow.
6. All user messages: User asked to implement compression tests.
7. Pending Tasks: Complete integration tests.
8. Current Work: Running compression integration tests.`;

  const text = summary || defaultSummary;
  const words = text.split(' ');
  const chunks: string[] = [];

  // Split into ~5 word chunks for streaming simulation
  for (let i = 0; i < words.length; i += 5) {
    chunks.push(`${words.slice(i, i + 5).join(' ')} `);
  }

  return createMockStreamResponse({
    textChunks: chunks,
    finishReason: 'stop',
    inputTokens: 500,
    outputTokens: 200,
  });
}

/**
 * Create mock error MockLanguageModelV2
 * For testing error handling scenarios
 */
export function createMockErrorModel(config?: {
  errorMessage?: string;
  errorOnStream?: boolean;
  errorOnGenerate?: boolean;
}) {
  const {
    errorMessage = 'Mock error',
    errorOnStream = true,
    errorOnGenerate = true,
  } = config || {};

  return new MockLanguageModelV2({
    doStream: async () => {
      if (errorOnStream) {
        throw new Error(errorMessage);
      }
      return {
        stream: simulateReadableStream({ chunks: defaultChunks() }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
    doGenerate: async () => {
      if (errorOnGenerate) {
        throw new Error(errorMessage);
      }
      return {
        rawCall: { rawPrompt: null, rawSettings: {} },
        finishReason: 'stop' as const,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        text: 'Mock response',
      };
    },
  });
}
