import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/lib/logger';
import {
  createEventQueue,
  isTerminalEvent,
  LlmEventStream,
  logStreamEvent,
  normalizeStreamEvent,
} from './llm-event-stream';
import type {
  AvailableModel,
  Message,
  ProviderConfig,
  StreamEvent,
  StreamResponse,
  StreamTextRequest,
} from './types';

export type StreamTextResult = {
  requestId: number;
  events: AsyncGenerator<StreamEvent, void, unknown>;
};

// Request ID counter for generating unique IDs
let requestIdCounter = 1000;

export class LlmClient {
  async streamText(
    request: StreamTextRequest,
    abortSignal?: AbortSignal
  ): Promise<StreamTextResult> {
    logger.info(`[LLM Client] Starting streamText for model: ${request.model}`);

    // Generate request ID first and set up listener BEFORE calling Rust
    // This prevents race condition where events are emitted before listener is ready
    const requestId = ++requestIdCounter;
    const eventName = `llm-stream-${requestId}`;
    const stream = new LlmEventStream();
    const queue = createEventQueue<StreamEvent>();

    logger.info(
      `[LLM Client ${requestId}] Generated requestId, setting up listener for: ${eventName}`
    );

    // Named abort handler for proper cleanup
    let onAbort: (() => void) | null = null;

    const stop = () => {
      logger.info(`[LLM Client ${requestId}] Stopping stream`);
      if (abortSignal && onAbort) {
        abortSignal.removeEventListener('abort', onAbort);
      }
      stream.close();
      queue.finish();
    };

    if (abortSignal) {
      if (abortSignal.aborted) {
        logger.info(`[LLM Client ${requestId}] Already aborted, stopping`);
        stop();
        throw new Error('LLM request aborted');
      }
      onAbort = () => {
        logger.info(`[LLM Client ${requestId}] Abort signal received, stopping`);
        stop();
      };
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }

    // Set up event listener BEFORE invoking Rust command
    await stream.listen(eventName, (event) => {
      logger.debug(`[LLM Client ${requestId}] Received event: ${event.type}`);
      const normalized = normalizeStreamEvent(event);
      logStreamEvent(normalized, requestId);
      queue.push(normalized);
      if (isTerminalEvent(normalized)) {
        logger.info(`[LLM Client ${requestId}] Terminal event received: ${event.type}`);
        stop();
      }
    });
    logger.info(
      `[LLM Client ${requestId}] Event listener setup complete, now invoking Rust command`
    );

    // Now invoke Rust command with the requestId
    let response: StreamResponse;
    try {
      response = await invoke<StreamResponse>('llm_stream_text', {
        request: { ...request, requestId },
      });
    } catch (error) {
      // Ensure cleanup on invoke failure to prevent listener leaks
      stop();
      throw error;
    }

    // Validate that the returned request_id matches what we sent
    if (response.request_id !== requestId) {
      stop();
      throw new Error(
        `LLM stream requestId mismatch: expected ${requestId}, got ${response.request_id}`
      );
    }

    logger.info(`[LLM Client] Stream started with requestId: ${response.request_id}`);

    return {
      requestId,
      events: queue.iterate(),
    };
  }

  async collectText(
    request: StreamTextRequest,
    abortSignal?: AbortSignal
  ): Promise<{ text: string; finishReason?: string | null }> {
    logger.info(`[LLM Client] collectText called for model: ${request.model}`);
    const { events } = await this.streamText(request, abortSignal);
    let text = '';
    let finishReason: string | null = null;
    let eventCount = 0;

    for await (const event of events) {
      eventCount++;
      if (event.type === 'text-delta') {
        text += event.text;
      }
      if (event.type === 'done') {
        finishReason = event.finish_reason ?? null;
        logger.info(
          `[LLM Client] Done event received after ${eventCount} events, finishReason: ${finishReason}`
        );
      }
      if (event.type === 'error') {
        logger.error(
          `[LLM Client] Error event received: ${(event as { message: string }).message}`
        );
      }
    }

    logger.info(
      `[LLM Client] collectText completed with ${eventCount} events, text length: ${text.length}`
    );

    return { text, finishReason };
  }

  async listAvailableModels(): Promise<AvailableModel[]> {
    return invoke<AvailableModel[]>('llm_list_available_models');
  }

  async getProviderConfigs(): Promise<ProviderConfig[]> {
    return invoke<ProviderConfig[]>('llm_get_provider_configs');
  }

  async isModelAvailable(modelIdentifier: string): Promise<boolean> {
    return invoke<boolean>('llm_is_model_available', { modelIdentifier });
  }

  async registerCustomProvider(config: {
    id: string;
    name: string;
    type: 'openai-compatible' | 'anthropic';
    baseUrl: string;
    apiKey: string;
    enabled: boolean;
    description?: string;
  }): Promise<void> {
    await invoke('llm_register_custom_provider', { config });
  }

  async setSetting(key: string, value: string): Promise<void> {
    await invoke('llm_set_setting', { key, value });
  }

  async startClaudeOAuth(): Promise<{ url: string; verifier: string }> {
    return invoke('llm_claude_oauth_start');
  }

  async completeClaudeOAuth(params: { code: string; verifier: string }): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  }> {
    return invoke('llm_claude_oauth_complete', params);
  }

  async refreshClaudeOAuth(params: { refreshToken: string }): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  }> {
    return invoke('llm_claude_oauth_refresh', params);
  }

  async startOpenAIOAuth(): Promise<{ url: string; verifier: string; state: string }> {
    return invoke('llm_openai_oauth_start');
  }

  async completeOpenAIOAuth(params: {
    code: string;
    verifier: string;
    expectedState?: string;
  }): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    accountId?: string;
  }> {
    return invoke('llm_openai_oauth_complete', params);
  }

  async refreshOpenAIOAuth(params: { refreshToken: string }): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    accountId?: string;
  }> {
    return invoke('llm_openai_oauth_refresh', params);
  }

  async readQwenCredentials(params: { path: string }): Promise<{
    access_token: string;
    refresh_token: string;
    token_type: string;
    resource_url: string;
    expiry_date: number;
  }> {
    return invoke('llm_qwen_read_credentials', params);
  }

  async readQwenToken(params: { path: string }): Promise<string> {
    return invoke('llm_qwen_read_token', params);
  }

  async validateQwenTokenPath(params: { path: string }): Promise<boolean> {
    return invoke('llm_qwen_validate_token_path', params);
  }

  async testQwenToken(params: { token: string }): Promise<boolean> {
    return invoke('llm_qwen_test_token', params);
  }

  async setQwenTokenPath(params: { path: string }): Promise<void> {
    await invoke('llm_qwen_set_token_path', params);
  }

  async clearQwenTokenPath(): Promise<void> {
    await invoke('llm_qwen_clear_token_path');
  }

  async disconnectClaudeOAuth(): Promise<void> {
    await invoke('llm_claude_oauth_disconnect');
  }

  async disconnectOpenAIOAuth(): Promise<void> {
    await invoke('llm_openai_oauth_disconnect');
  }

  async getOAuthStatus(): Promise<{
    anthropic?: {
      accessToken?: string | null;
      refreshToken?: string | null;
      expiresAt?: number | null;
    } | null;
    openai?: {
      accessToken?: string | null;
      refreshToken?: string | null;
      expiresAt?: number | null;
      accountId?: string | null;
    } | null;
    qwen?: {
      accessToken?: string | null;
      tokenPath?: string | null;
      isConnected?: boolean | null;
    } | null;
    githubCopilot?: {
      accessToken?: string | null;
      copilotToken?: string | null;
      enterpriseUrl?: string | null;
    } | null;
  } | null> {
    return invoke('llm_oauth_status');
  }

  async listMcpTools(): Promise<
    Array<{
      id: string;
      name: string;
      description?: string | null;
      serverId: string;
      serverName?: string | null;
      inputSchema?: unknown;
    }>
  > {
    return invoke('mcp_list_tools');
  }

  async getMcpTool(prefixedName: string): Promise<{
    name: string;
    description?: string | null;
    inputSchema?: unknown;
    serverId: string;
    serverName?: string | null;
    prefixedName: string;
  }> {
    return invoke('mcp_get_tool', { prefixedName });
  }

  async getMcpServerStatuses(): Promise<
    Record<string, { isConnected: boolean; error?: string | null; toolCount: number }>
  > {
    return invoke('mcp_get_statuses');
  }

  async refreshMcpConnections(): Promise<void> {
    await invoke('mcp_refresh_connections');
  }

  async refreshMcpServer(serverId: string): Promise<void> {
    await invoke('mcp_refresh_server', { serverId });
  }

  async testMcpConnection(serverId: string): Promise<{
    success: boolean;
    error?: string | null;
    toolCount?: number | null;
  }> {
    return invoke('mcp_test_connection', { serverId });
  }

  async mcpHealthCheck(): Promise<boolean> {
    return invoke('mcp_health_check');
  }
}

export const llmClient = new LlmClient();

export function buildPromptRequest(
  model: string,
  prompt: string,
  providerOptions?: Record<string, unknown>,
  temperature?: number,
  maxTokens?: number,
  topP?: number,
  topK?: number
): StreamTextRequest {
  const message: Message = {
    role: 'user',
    content: prompt,
  };

  return {
    model,
    messages: [message],
    stream: true,
    providerOptions: providerOptions ?? undefined,
    temperature,
    maxTokens,
    topP,
    topK,
  };
}

export function buildMessagesRequest(
  model: string,
  messages: Message[],
  providerOptions?: Record<string, unknown>,
  temperature?: number,
  maxTokens?: number,
  topP?: number,
  topK?: number
): StreamTextRequest {
  return {
    model,
    messages,
    stream: true,
    providerOptions: providerOptions ?? undefined,
    temperature,
    maxTokens,
    topP,
    topK,
  };
}
