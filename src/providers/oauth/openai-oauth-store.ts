// src/providers/oauth/openai-oauth-store.ts
// Zustand store for OpenAI ChatGPT OAuth state management

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { llmClient } from '@/services/llm/llm-client';
import {
  exchangeCode,
  isTokenExpired,
  refreshAccessToken,
  startOAuthFlow,
} from './openai-oauth-service';

// OAuth callback result from Rust server
interface OAuthCallbackResult {
  success: boolean;
  code: string | null;
  state: string | null;
  error: string | null;
}

interface OpenAIOAuthState {
  // Connection state
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;

  // Tokens (in-memory)
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  accountId: string | null;

  // OAuth flow state (temporary during flow)
  verifier: string | null;
  expectedState: string | null;

  // Initialization
  isInitialized: boolean;

  // Callback server state
  callbackServerPort: number | null;
  callbackUnlisten: UnlistenFn | null;
}

interface OpenAIOAuthActions {
  // Initialize from storage
  initialize: () => Promise<void>;

  // OAuth flow
  startOAuth: () => Promise<string>;
  startOAuthWithAutoCallback: () => Promise<string>;
  completeOAuth: (code: string) => Promise<void>;
  disconnect: () => Promise<void>;
  cleanupCallbackListener: () => void;

  // Token management
  getValidAccessToken: () => Promise<string | null>;
  refreshTokenIfNeeded: () => Promise<boolean>;
}

type OpenAIOAuthStore = OpenAIOAuthState & OpenAIOAuthActions;

async function loadOAuthSnapshot() {
  try {
    return await llmClient.getOAuthStatus();
  } catch (error) {
    logger.warn('[OpenAIOAuth] Failed to read OAuth status from Rust:', error);
    return null;
  }
}

export const useOpenAIOAuthStore = create<OpenAIOAuthStore>((set, get) => ({
  // Initial state
  isConnected: false,
  isLoading: false,
  error: null,
  accessToken: null,
  refreshToken: null,
  expiresAt: null,
  accountId: null,
  verifier: null,
  expectedState: null,
  isInitialized: false,
  callbackServerPort: null,
  callbackUnlisten: null,

  // Initialize from storage
  initialize: async () => {
    const { isInitialized, isLoading } = get();
    if (isInitialized || isLoading) return;

    set({ isLoading: true, error: null });

    try {
      logger.info('[OpenAIOAuth] Initializing store');

      const snapshot = await loadOAuthSnapshot();
      const accessToken = snapshot?.openai?.accessToken || null;
      const refreshToken = snapshot?.openai?.refreshToken || null;
      const expiresAt = snapshot?.openai?.expiresAt || null;
      const accountId = snapshot?.openai?.accountId || null;

      const isConnected = !!(accessToken && refreshToken && expiresAt);

      logger.info('[OpenAIOAuth] Initialized', { isConnected });

      set({
        accessToken,
        refreshToken,
        expiresAt,
        accountId,
        isConnected,
        isLoading: false,
        isInitialized: true,
      });
    } catch (error) {
      logger.error('[OpenAIOAuth] Initialization error:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to initialize',
        isLoading: false,
        isInitialized: true,
      });
    }
  },

  // Start OAuth flow - returns URL to open in browser
  startOAuth: async () => {
    set({ isLoading: true, error: null });

    try {
      const result = await startOAuthFlow();

      set({
        verifier: result.verifier,
        expectedState: result.state,
        isLoading: false,
      });

      logger.info('[OpenAIOAuth] OAuth flow started');
      return result.url;
    } catch (error) {
      logger.error('[OpenAIOAuth] Failed to start OAuth:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to start OAuth',
        isLoading: false,
      });
      throw error;
    }
  },

  // Start OAuth with automatic callback handling via Rust HTTP server
  startOAuthWithAutoCallback: async () => {
    // Cleanup any previous listener
    get().cleanupCallbackListener();

    set({ isLoading: true, error: null });

    try {
      // Generate OAuth flow first to get state
      const oauthResult = await startOAuthFlow();

      // Start the callback server with expected state
      const port = await invoke<number>('start_oauth_callback_server', {
        expectedState: oauthResult.state,
      });

      // Check if we got a different port than default (port was in use)
      if (port !== 1455) {
        logger.warn('[OpenAIOAuth] Default port was in use, using alternative port:', port);
      }

      logger.info('[OpenAIOAuth] Callback server started on port:', port);

      // Listen for callback event
      const unlisten = await listen<OAuthCallbackResult>('openai-oauth-callback', async (event) => {
        const result = event.payload;
        logger.info('[OpenAIOAuth] Callback received:', result);

        if (result.success && result.code) {
          // Auto-complete OAuth flow
          try {
            await get().completeOAuth(result.code);
            logger.info('[OpenAIOAuth] Auto OAuth completed successfully');
          } catch (err) {
            logger.error('[OpenAIOAuth] Failed to complete auto OAuth:', err);
            set({
              error: err instanceof Error ? err.message : 'Failed to complete OAuth',
              isLoading: false,
            });
          }
        } else if (result.error) {
          logger.error('[OpenAIOAuth] Callback error:', result.error);
          set({
            error: result.error,
            isLoading: false,
          });
        }

        // Cleanup listener after receiving callback
        get().cleanupCallbackListener();
      });

      set({
        verifier: oauthResult.verifier,
        expectedState: oauthResult.state,
        callbackServerPort: port,
        callbackUnlisten: unlisten,
        isLoading: false,
      });

      logger.info('[OpenAIOAuth] OAuth with auto callback started');
      return oauthResult.url;
    } catch (error) {
      logger.error('[OpenAIOAuth] Failed to start OAuth with auto callback:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to start OAuth',
        isLoading: false,
      });
      throw error;
    }
  },

  // Cleanup callback listener
  cleanupCallbackListener: () => {
    const { callbackUnlisten } = get();
    if (callbackUnlisten) {
      callbackUnlisten();
      set({ callbackUnlisten: null, callbackServerPort: null });
      logger.info('[OpenAIOAuth] Callback listener cleaned up');
    }
  },

  // Complete OAuth flow with authorization code (or full callback URL)
  completeOAuth: async (code: string) => {
    const { verifier, expectedState } = get();

    if (!verifier) {
      throw new Error('No verifier found. Please start OAuth flow first.');
    }

    set({ isLoading: true, error: null });

    try {
      const result = await exchangeCode(code, verifier, expectedState || undefined);

      if (result.type === 'failed' || !result.tokens) {
        throw new Error(result.error || 'Token exchange failed');
      }

      const { accessToken, refreshToken, expiresAt, accountId } = result.tokens;

      logger.info('[OpenAIOAuth] OAuth completed successfully');

      set({
        accessToken,
        refreshToken,
        expiresAt,
        accountId: accountId || null,
        isConnected: true,
        verifier: null,
        expectedState: null,
        isLoading: false,
      });
    } catch (error) {
      logger.error('[OpenAIOAuth] Failed to complete OAuth:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to complete OAuth',
        verifier: null,
        expectedState: null,
        isLoading: false,
      });
      throw error;
    }
  },

  // Disconnect and clear tokens
  disconnect: async () => {
    set({ isLoading: true, error: null });

    try {
      await llmClient.disconnectOpenAIOAuth();

      logger.info('[OpenAIOAuth] Disconnected');

      set({
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        accountId: null,
        isConnected: false,
        isLoading: false,
      });
    } catch (error) {
      logger.error('[OpenAIOAuth] Failed to disconnect:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to disconnect',
        isLoading: false,
      });
      throw error;
    }
  },

  // Get a valid access token (refresh if needed)
  getValidAccessToken: async () => {
    const state = get();

    if (!state.isConnected || !state.refreshToken) {
      return null;
    }

    // Check if token is expired
    if (state.expiresAt && isTokenExpired(state.expiresAt)) {
      logger.info('[OpenAIOAuth] Token expired, refreshing...');
      const success = await get().refreshTokenIfNeeded();
      if (!success) {
        return null;
      }
    }

    return get().accessToken;
  },

  // Refresh token if needed
  refreshTokenIfNeeded: async () => {
    const { refreshToken, expiresAt } = get();

    if (!refreshToken) {
      return false;
    }

    // Only refresh if expired
    if (expiresAt && !isTokenExpired(expiresAt)) {
      return true;
    }

    try {
      const result = await refreshAccessToken(refreshToken);

      if (result.type === 'failed' || !result.tokens) {
        logger.error('[OpenAIOAuth] Token refresh failed:', result.error);
        // Clear tokens on refresh failure
        await get().disconnect();
        return false;
      }

      const {
        accessToken,
        refreshToken: newRefreshToken,
        expiresAt: newExpiresAt,
        accountId,
      } = result.tokens;

      logger.info('[OpenAIOAuth] Token refreshed successfully');

      set({
        accessToken,
        refreshToken: newRefreshToken,
        expiresAt: newExpiresAt,
        accountId: accountId || null,
      });

      return true;
    } catch (error) {
      logger.error('[OpenAIOAuth] Token refresh error:', error);
      return false;
    }
  },
}));

// Selector for connection status
export const selectIsOpenAIOAuthConnected = (state: OpenAIOAuthStore) => state.isConnected;

// Export async helper for checking OAuth status
export async function isOpenAIOAuthConnected(): Promise<boolean> {
  const store = useOpenAIOAuthStore.getState();
  if (!store.isInitialized) {
    await store.initialize();
  }
  return useOpenAIOAuthStore.getState().isConnected;
}

// Export async helper for getting valid access token
export async function getOpenAIOAuthAccessToken(): Promise<string | null> {
  const store = useOpenAIOAuthStore.getState();
  if (!store.isInitialized) {
    await store.initialize();
  }
  return useOpenAIOAuthStore.getState().getValidAccessToken();
}

// Export async helper for getting account ID
export async function getOpenAIOAuthAccountId(): Promise<string | null> {
  const store = useOpenAIOAuthStore.getState();
  if (!store.isInitialized) {
    await store.initialize();
  }
  return useOpenAIOAuthStore.getState().accountId;
}
