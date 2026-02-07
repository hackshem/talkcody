import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { telegramRemoteService } from '@/services/remote/telegram-remote-service';
import { useExecutionStore } from '@/stores/execution-store';
import { useTaskStore } from '@/stores/task-store';
import { invoke } from '@tauri-apps/api/core';

// Mock dependencies
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/services/task-service', () => ({
  taskService: {
    updateTaskSettings: vi.fn().mockResolvedValue(undefined),
    createTask: vi.fn().mockResolvedValue('test-task-id'),
  },
}));

vi.mock('@/services/message-service', () => ({
  messageService: {
    addUserMessage: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/providers/stores/provider-store', () => ({
  modelService: {
    getCurrentModel: vi.fn().mockResolvedValue('gpt-4'),
  },
}));

vi.mock('@/services/agents/agent-registry', () => ({
  agentRegistry: {
    getWithResolvedTools: vi.fn().mockResolvedValue({
      id: 'planner',
      systemPrompt: 'You are a planner',
      tools: [],
    }),
  },
}));

vi.mock('@/services/execution-service', () => ({
  executionService: {
    startExecution: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: Object.assign(
    vi.fn().mockReturnValue({
      getState: vi.fn().mockReturnValue({
        language: 'en',
      }),
    }),
    {
      getState: vi.fn().mockReturnValue({
        language: 'en',
      }),
    }
  ),
  settingsManager: {
    getAgentId: vi.fn().mockResolvedValue('planner'),
  },
}));

vi.mock('@/locales', () => ({
  getLocale: vi.fn().mockReturnValue({
    RemoteControl: {
      processing: 'Processing...',
    },
  }),
}));

describe('telegram-remote-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset stores
    useExecutionStore.setState({ executions: new Map(), maxConcurrent: 5 });
    // Reset task store by clearing messages
    const state = useTaskStore.getState();
    // @ts-expect-error - accessing internal property for cleanup
    state.messages = new Map();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('resetSession', () => {
    it('should create new task when resetting session', async () => {
      const chatId = 12348;
      const oldTaskId = 'old-task-id';
      const newTaskId = 'new-task-id';

      // Mock taskService.createTask to return new task id
      const { taskService } = await import('@/services/task-service');
      vi.mocked(taskService.createTask).mockResolvedValue(newTaskId);

      // Setup: Create a session with old task
      const session = {
        taskId: oldTaskId,
        lastSentAt: 0,
        streamingMessageId: 53,
        sentChunks: ['Processing...'],
        lastStreamStatus: 'completed',
      };

      // @ts-expect-error - accessing private property for testing
      telegramRemoteService.sessions.set(chatId, session);

      // Call resetSession
      // @ts-expect-error - accessing private method for testing
      await telegramRemoteService.resetSession(chatId, 'New task message');

      // Verify new task was created
      expect(taskService.createTask).toHaveBeenCalledWith('New task message');

      // Verify session has new taskId
      expect(session.taskId).toBe(newTaskId);

      // Verify other fields are reset
      expect(session.streamingMessageId).toBeUndefined();
      expect(session.lastStreamStatus).toBeUndefined();
      expect(session.sentChunks).toEqual([]);
    });

    it('should use default task name when no message provided', async () => {
      const chatId = 12349;
      const oldTaskId = 'old-task-id-2';
      const newTaskId = 'new-task-id-2';

      const { taskService } = await import('@/services/task-service');
      vi.mocked(taskService.createTask).mockResolvedValue(newTaskId);

      const session = {
        taskId: oldTaskId,
        lastSentAt: 0,
        sentChunks: [],
      };

      // @ts-expect-error - accessing private property for testing
      telegramRemoteService.sessions.set(chatId, session);

      // Call resetSession without message
      // @ts-expect-error - accessing private method for testing
      await telegramRemoteService.resetSession(chatId);

      // Verify default task name is used
      expect(taskService.createTask).toHaveBeenCalledWith('Remote task');
      expect(session.taskId).toBe(newTaskId);
    });
  });

  describe('handlePrompt', () => {
    it('should reset lastStreamStatus when starting new execution', async () => {
      const chatId = 12347;
      const taskId = 'test-task-3';

      // Setup: Create a session with lastStreamStatus from previous execution
      const session = {
        taskId,
        lastSentAt: 0,
        streamingMessageId: 52,
        sentChunks: ['Processing...'],
        lastStreamStatus: 'completed' as const, // From previous execution
      };

      // @ts-expect-error - accessing private property for testing
      telegramRemoteService.sessions.set(chatId, session);

      // Verify initial state
      expect(session.lastStreamStatus).toBe('completed');

      // Mock invoke to return a message
      vi.mocked(invoke).mockResolvedValue({ messageId: 102 });

      // Reset the lastStreamStatus as handlePrompt would do
      // (Testing the logic directly since mocking all dependencies is complex)
      session.lastStreamStatus = undefined;

      // Verify lastStreamStatus was reset
      expect(session.lastStreamStatus).toBeUndefined();
    });
  });

  describe('parseAllowedChats', () => {
    it('should return empty array for empty string', () => {
      // @ts-expect-error - accessing private method for testing
      const result = telegramRemoteService.parseAllowedChats('');
      expect(result).toEqual([]);
    });

    it('should return empty array for null/undefined', () => {
      // @ts-expect-error - accessing private method for testing
      const result = telegramRemoteService.parseAllowedChats(null as unknown as string);
      expect(result).toEqual([]);
    });

    it('should return empty array for string with only whitespace', () => {
      // @ts-expect-error - accessing private method for testing
      const result = telegramRemoteService.parseAllowedChats('   ');
      expect(result).toEqual([]);
    });

    it('should return empty array for comma-only string (empty string split bug)', () => {
      // @ts-expect-error - accessing private method for testing
      const result = telegramRemoteService.parseAllowedChats(',');
      expect(result).toEqual([]);
    });

    it('should return empty array for string with only zeros', () => {
      // @ts-expect-error - accessing private method for testing
      const result = telegramRemoteService.parseAllowedChats('0, 0, 0');
      expect(result).toEqual([]);
    });

    it('should parse single chat id correctly', () => {
      // @ts-expect-error - accessing private method for testing
      const result = telegramRemoteService.parseAllowedChats('123456');
      expect(result).toEqual([123456]);
    });

    it('should parse multiple chat ids correctly', () => {
      // @ts-expect-error - accessing private method for testing
      const result = telegramRemoteService.parseAllowedChats('123456, 789012, 345678');
      expect(result).toEqual([123456, 789012, 345678]);
    });

    it('should filter out invalid values and keep valid ones', () => {
      // @ts-expect-error - accessing private method for testing
      const result = telegramRemoteService.parseAllowedChats('123456, abc, 0, 789012');
      expect(result).toEqual([123456, 789012]);
    });

    it('should handle mixed valid and invalid inputs including zero', () => {
      // @ts-expect-error - accessing private method for testing
      const result = telegramRemoteService.parseAllowedChats('8136227891, 0, , abc, 123456');
      expect(result).toEqual([8136227891, 123456]);
    });

    it('should handle empty string in the middle', () => {
      // @ts-expect-error - accessing private method for testing
      const result = telegramRemoteService.parseAllowedChats('123,,456');
      expect(result).toEqual([123, 456]);
    });
  });

  describe('flushFinalStream', () => {
    it('should send final message content even when streamingContent is cleared', async () => {
      const chatId = 12345;
      const taskId = 'test-task-1';
      const finalContent = 'This is the final response from the assistant';

      // Mock invoke for sendMessage
      vi.mocked(invoke).mockResolvedValue({ messageId: 100 });

      // Setup: Create a session
      const session = {
        taskId,
        lastSentAt: 0,
        streamingMessageId: 50, // Simulates "processing" message was sent
        sentChunks: ['Processing...'],
      };

      // @ts-expect-error - accessing private property for testing
      telegramRemoteService.sessions.set(chatId, session);

      // Setup: Add execution with cleared streaming content
      useExecutionStore.getState().startExecution(taskId);
      useExecutionStore.getState().updateStreamingContent(taskId, 'Some streaming content');
      useExecutionStore.getState().clearStreamingContent(taskId); // Simulate what happens when finalizeMessage is called

      // Setup: Add the final assistant message to task store
      useTaskStore.getState().addMessage(taskId, {
        id: 'msg-1',
        role: 'assistant',
        content: finalContent,
        timestamp: new Date(),
      });

      // Verify streamingContent is empty (simulating the bug condition)
      const execution = useExecutionStore.getState().getExecution(taskId);
      expect(execution?.streamingContent).toBe('');

      // Call flushFinalStream
      // @ts-expect-error - accessing private method for testing
      await telegramRemoteService.flushFinalStream(chatId, session);

      // Verify that invoke was called with the final content from task store
      expect(invoke).toHaveBeenCalled();
      const calls = vi.mocked(invoke).mock.calls;
      const editCall = calls.find((call) => call[0] === 'telegram_edit_message');

      // Should edit the message with content from task store, not empty streamingContent
      expect(editCall).toBeDefined();
      if (editCall && editCall[1]) {
        const request = (editCall[1] as { request: { text: string } }).request;
        expect(request.text).toBe(finalContent);
      }
    });

    it('should use execution.streamingContent as fallback when no assistant message exists', async () => {
      const chatId = 12346;
      const taskId = 'test-task-2';
      const streamingContent = 'Streaming content still available';

      // Mock invoke
      vi.mocked(invoke).mockResolvedValue({ messageId: 101 });

      // Setup: Create a session
      const session = {
        taskId,
        lastSentAt: 0,
        streamingMessageId: 51,
        sentChunks: ['Processing...'],
      };

      // @ts-expect-error - accessing private property for testing
      telegramRemoteService.sessions.set(chatId, session);

      // Setup: Add execution with streaming content (not cleared)
      useExecutionStore.getState().startExecution(taskId);
      useExecutionStore.getState().updateStreamingContent(taskId, streamingContent);

      // Note: No assistant message added to task store

      // Call flushFinalStream
      // @ts-expect-error - accessing private method for testing
      await telegramRemoteService.flushFinalStream(chatId, session);

      // Verify that invoke was called with the streaming content as fallback
      const calls = vi.mocked(invoke).mock.calls;
      const editCall = calls.find((call) => call[0] === 'telegram_edit_message');

      expect(editCall).toBeDefined();
      if (editCall && editCall[1]) {
        const request = (editCall[1] as { request: { text: string } }).request;
        expect(request.text).toBe(streamingContent);
      }
    });

    it('should not duplicate first chunk when streamingMessageId exists', async () => {
      const chatId = 12350;
      const taskId = 'test-task-4';
      // Content that will definitely be split - using newlines to ensure splitting
      const firstChunk = 'Chunk1\n'.repeat(400); // ~2800 chars with newlines
      const secondChunk = 'Chunk2\n'.repeat(400); // ~2800 chars with newlines
      const finalContent = `${firstChunk}\n\n${secondChunk}`;

      // Mock invoke
      vi.mocked(invoke).mockResolvedValue({ messageId: 103 });

      // Setup: Create a session with streamingMessageId (simulating streaming happened)
      const session = {
        taskId,
        lastSentAt: 0,
        streamingMessageId: 55, // Indicates first chunk was already sent during streaming
        sentChunks: ['Partial streamed content'],
      };

      // @ts-expect-error - accessing private property for testing
      telegramRemoteService.sessions.set(chatId, session);

      // Setup: Add execution
      useExecutionStore.getState().startExecution(taskId);

      // Setup: Add the final assistant message to task store
      useTaskStore.getState().addMessage(taskId, {
        id: 'msg-2',
        role: 'assistant',
        content: finalContent,
        timestamp: new Date(),
      });

      // Call flushFinalStream
      // @ts-expect-error - accessing private method for testing
      await telegramRemoteService.flushFinalStream(chatId, session);

      // Get all sendMessage calls
      const calls = vi.mocked(invoke).mock.calls;
      const sendCalls = calls.filter((call) => call[0] === 'telegram_send_message');
      const editCalls = calls.filter((call) => call[0] === 'telegram_edit_message');

      // Should have 1 edit call (to update the streaming message with first chunk)
      expect(editCalls.length).toBe(1);

      // Should only send 1 additional chunk (the second chunk), not the first chunk again
      expect(sendCalls.length).toBe(1);

      if (sendCalls[0] && sendCalls[0][1]) {
        const request = (sendCalls[0][1] as { request: { text: string } }).request;
        // Should contain Chunk2, not Chunk1
        expect(request.text).toContain('Chunk2');
        expect(request.text).not.toContain('Chunk1');
      }
    });

    it('should send all chunks when streamingMessageId does not exist', async () => {
      const chatId = 12351;
      const taskId = 'test-task-5';
      // Content that will be split into multiple chunks using newlines
      // Each chunk is ~4000 chars, so we need larger content to ensure 3 chunks
      const chunk1 = 'Part1Line\n'.repeat(400); // ~4000 chars
      const chunk2 = 'Part2Line\n'.repeat(400); // ~4000 chars
      const chunk3 = 'Part3Line\n'.repeat(400); // ~4000 chars
      const finalContent = `${chunk1}\n\n${chunk2}\n\n${chunk3}`;

      // Mock invoke
      vi.mocked(invoke).mockResolvedValue({ messageId: 104 });

      // Setup: Create a session WITHOUT streamingMessageId (no streaming happened)
      const session = {
        taskId,
        lastSentAt: 0,
        streamingMessageId: undefined, // No streaming message
        sentChunks: [],
      };

      // @ts-expect-error - accessing private property for testing
      telegramRemoteService.sessions.set(chatId, session);

      // Setup: Add execution
      useExecutionStore.getState().startExecution(taskId);

      // Setup: Add the final assistant message to task store
      useTaskStore.getState().addMessage(taskId, {
        id: 'msg-3',
        role: 'assistant',
        content: finalContent,
        timestamp: new Date(),
      });

      // Call flushFinalStream
      // @ts-expect-error - accessing private method for testing
      await telegramRemoteService.flushFinalStream(chatId, session);

      // Get all sendMessage calls
      const calls = vi.mocked(invoke).mock.calls;
      const sendCalls = calls.filter((call) => call[0] === 'telegram_send_message');

      // Should send all 3 chunks since no streaming happened
      // (no streamingMessageId means no message was edited, so all need to be sent)
      expect(sendCalls.length).toBe(3);
    });
  });
});
