/**
 * Tests for LLM test helpers
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createMockLLM,
  createStreamTextMock,
  createMockStreamResponse,
  createCompressionSummaryResponse,
  createMockErrorModel,
  streamScenarios,
} from './llm-test-helpers';

describe('llm-test-helpers', () => {
  describe('createMockLLM', () => {
    it('should create a mock LLM with default response', async () => {
      const mockLLM = createMockLLM();

      const result = await mockLLM.doGenerate({
        inputFormat: 'messages',
        mode: { type: 'regular' },
        prompt: [],
      });

      expect(result.text).toBe('Mock response');
      expect(result.finishReason).toBe('stop');
      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);
    });

    it('should create a mock LLM with custom text', async () => {
      const mockLLM = createMockLLM({ text: 'Custom response' });

      const result = await mockLLM.doGenerate({
        inputFormat: 'messages',
        mode: { type: 'regular' },
        prompt: [],
      });

      expect(result.text).toBe('Custom response');
    });

    it('should create a mock LLM that throws errors', async () => {
      const mockLLM = createMockLLM({
        shouldError: true,
        errorMessage: 'API rate limit exceeded',
      });

      await expect(
        mockLLM.doGenerate({
          inputFormat: 'messages',
          mode: { type: 'regular' },
          prompt: [],
        })
      ).rejects.toThrow('API rate limit exceeded');

      await expect(
        mockLLM.doStream({
          inputFormat: 'messages',
          mode: { type: 'regular' },
          prompt: [],
        })
      ).rejects.toThrow('API rate limit exceeded');
    });

    it('should create a mock LLM with custom token usage', async () => {
      const mockLLM = createMockLLM({
        inputTokens: 500,
        outputTokens: 200,
      });

      const result = await mockLLM.doGenerate({
        inputFormat: 'messages',
        mode: { type: 'regular' },
        prompt: [],
      });

      expect(result.usage.inputTokens).toBe(500);
      expect(result.usage.outputTokens).toBe(200);
    });

    it('should support streaming', async () => {
      const mockLLM = createMockLLM({ text: 'Hello world' });

      const result = await mockLLM.doStream({
        inputFormat: 'messages',
        mode: { type: 'regular' },
        prompt: [],
      });

      expect(result.stream).toBeDefined();
      expect(result.rawCall).toBeDefined();
    });
  });

  describe('createStreamTextMock', () => {
    it('should create a stream with text chunks', async () => {
      const mock = createStreamTextMock({
        textChunks: ['Hello', ' world'],
      });

      const chunks: unknown[] = [];
      for await (const chunk of mock.fullStream) {
        chunks.push(chunk);
      }

      expect(chunks).toContainEqual({ type: 'text-start' });
      expect(chunks).toContainEqual({ type: 'text-delta', text: 'Hello' });
      expect(chunks).toContainEqual({ type: 'text-delta', text: ' world' });
      expect(chunks).toContainEqual(
        expect.objectContaining({ type: 'step-finish', finishReason: 'stop' })
      );
    });

    it('should create a stream with tool calls', async () => {
      const mock = createStreamTextMock({
        textChunks: ['Processing...'],
        toolCalls: [
          { toolCallId: 'tc-1', toolName: 'readFile', args: { path: '/test.ts' } },
        ],
      });

      const chunks: unknown[] = [];
      for await (const chunk of mock.fullStream) {
        chunks.push(chunk);
      }

      expect(chunks).toContainEqual(
        expect.objectContaining({
          type: 'tool-call',
          toolName: 'readFile',
          args: { path: '/test.ts' },
        })
      );
      expect(chunks).toContainEqual(
        expect.objectContaining({ type: 'step-finish', finishReason: 'tool-calls' })
      );
    });

    it('should auto-set finishReason to tool-calls when toolCalls are present', async () => {
      const mock = createStreamTextMock({
        toolCalls: [{ toolCallId: 'tc-1', toolName: 'test', args: {} }],
      });

      const finishReason = await mock.finishReason;
      expect(finishReason).toBe('tool-calls');
    });

    it('should default finishReason to stop when no toolCalls', async () => {
      const mock = createStreamTextMock({
        textChunks: ['Hello'],
      });

      const finishReason = await mock.finishReason;
      expect(finishReason).toBe('stop');
    });
  });

  describe('createMockStreamResponse', () => {
    it('should create a MockLanguageModelV2 doStream format response', () => {
      const response = createMockStreamResponse({
        textChunks: ['Hello', ' world'],
      });

      expect(response.stream).toBeDefined();
      expect(response.rawCall).toEqual({ rawPrompt: null, rawSettings: {} });
    });
  });

  describe('streamScenarios', () => {
    it('simpleText should create a simple text response', async () => {
      const mock = streamScenarios.simpleText('Hello!');

      const chunks: unknown[] = [];
      for await (const chunk of mock.fullStream) {
        chunks.push(chunk);
      }

      expect(chunks).toContainEqual({ type: 'text-delta', text: 'Hello!' });
    });

    it('withToolCall should create a response with tool call', async () => {
      const mock = streamScenarios.withToolCall('readFile', { path: '/test.ts' });

      const chunks: unknown[] = [];
      for await (const chunk of mock.fullStream) {
        chunks.push(chunk);
      }

      expect(chunks).toContainEqual(
        expect.objectContaining({
          type: 'tool-call',
          toolName: 'readFile',
        })
      );
    });

    it('multipleToolCalls should create multiple tool calls', async () => {
      const mock = streamScenarios.multipleToolCalls([
        { name: 'readFile', args: { path: '/a.ts' } },
        { name: 'readFile', args: { path: '/b.ts' } },
      ]);

      const chunks: unknown[] = [];
      for await (const chunk of mock.fullStream) {
        chunks.push(chunk);
      }

      const toolCalls = chunks.filter(
        (c: unknown) => typeof c === 'object' && c !== null && (c as { type: string }).type === 'tool-call'
      );
      expect(toolCalls).toHaveLength(2);
    });

    it('emptyToolCallsBug should reproduce the empty tool-calls bug', async () => {
      const mock = streamScenarios.emptyToolCallsBug();

      const chunks: unknown[] = [];
      for await (const chunk of mock.fullStream) {
        chunks.push(chunk);
      }

      // Should have text but finishReason is tool-calls (the bug)
      expect(chunks).toContainEqual({ type: 'text-delta', text: 'Task completed.' });
      expect(chunks).toContainEqual(
        expect.objectContaining({ type: 'step-finish', finishReason: 'tool-calls' })
      );

      // Should NOT have any tool-call events
      const toolCalls = chunks.filter(
        (c: unknown) => typeof c === 'object' && c !== null && (c as { type: string }).type === 'tool-call'
      );
      expect(toolCalls).toHaveLength(0);
    });

    it('streamError should produce an error event', async () => {
      const mock = streamScenarios.streamError();

      const chunks: unknown[] = [];
      for await (const chunk of mock.fullStream) {
        chunks.push(chunk);
      }

      expect(chunks).toContainEqual(
        expect.objectContaining({ type: 'error' })
      );
    });

    it('emptyResponse should create an empty response', async () => {
      const mock = streamScenarios.emptyResponse();

      const chunks: unknown[] = [];
      for await (const chunk of mock.fullStream) {
        chunks.push(chunk);
      }

      // Should only have text-start and step-finish, no text-delta with content
      const textDeltas = chunks.filter(
        (c: unknown) =>
          typeof c === 'object' &&
          c !== null &&
          (c as { type: string }).type === 'text-delta' &&
          (c as { text?: string }).text
      );
      expect(textDeltas).toHaveLength(0);
    });
  });

  describe('createCompressionSummaryResponse', () => {
    it('should create a compression summary response with default summary', () => {
      const response = createCompressionSummaryResponse();

      expect(response.stream).toBeDefined();
      expect(response.rawCall).toEqual({ rawPrompt: null, rawSettings: {} });
    });

    it('should create a compression summary response with custom summary', () => {
      const customSummary = 'Custom compression summary for testing';
      const response = createCompressionSummaryResponse(customSummary);

      expect(response.stream).toBeDefined();
    });
  });

  describe('createMockErrorModel', () => {
    it('should create a model that errors on both stream and generate', async () => {
      const model = createMockErrorModel({ errorMessage: 'Test error' });

      await expect(
        model.doStream({
          inputFormat: 'messages',
          mode: { type: 'regular' },
          prompt: [],
        })
      ).rejects.toThrow('Test error');

      await expect(
        model.doGenerate({
          inputFormat: 'messages',
          mode: { type: 'regular' },
          prompt: [],
        })
      ).rejects.toThrow('Test error');
    });

    it('should allow selective error on stream only', async () => {
      const model = createMockErrorModel({
        errorOnStream: true,
        errorOnGenerate: false,
      });

      await expect(
        model.doStream({
          inputFormat: 'messages',
          mode: { type: 'regular' },
          prompt: [],
        })
      ).rejects.toThrow();

      // Should not throw on generate
      const result = await model.doGenerate({
        inputFormat: 'messages',
        mode: { type: 'regular' },
        prompt: [],
      });
      expect(result.text).toBe('Mock response');
    });
  });
});
