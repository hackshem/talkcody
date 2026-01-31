// src/providers/oauth/claude-oauth-store.ts
// Zustand store for Claude OAuth state management

import { create } from 'zustand';
import { logger } from '@/lib/logger';
import { llmClient } from '@/services/llm/llm-client';
import {
  exchangeCode,
  isTokenExpired,
  refreshAccessToken,
  startOAuthFlow,
} from './claude-oauth-service';

interface ClaudeOAuthState {
  // Connection state
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;

  // Tokens (in-memory)
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;

  // OAuth flow state (temporary during flow)
  verifier: string | null;

  // Initialization
  isInitialized: boolean;
}

interface ClaudeOAuthActions {
  // Initialize from storage
  initialize: () => Promise<void>;

  // OAuth flow
  startOAuth: () => Promise<string>;
  completeOAuth: (code: string) => Promise<void>;
  disconnect: () => Promise<void>;

  // Token management
  getValidAccessToken: () => Promise<string | null>;
  refreshTokenIfNeeded: () => Promise<boolean>;
}

type ClaudeOAuthStore = ClaudeOAuthState & ClaudeOAuthActions;

async function loadOAuthSnapshot() {
  try {
    return await llmClient.getOAuthStatus();
  } catch (error) {
    logger.warn('[ClaudeOAuth] Failed to read OAuth status from Rust:', error);
    return null;
  }
}

export const useClaudeOAuthStore = create<ClaudeOAuthStore>((set, get) => ({
  // Initial state
  isConnected: false,
  isLoading: false,
  error: null,
  accessToken: null,
  refreshToken: null,
  expiresAt: null,
  verifier: null,
  isInitialized: false,

  // Initialize from storage
  initialize: async () => {
    const { isInitialized, isLoading } = get();
    if (isInitialized || isLoading) return;

    set({ isLoading: true, error: null });

    try {
      logger.info('[ClaudeOAuth] Initializing store');

      const snapshot = await loadOAuthSnapshot();
      const accessToken = snapshot?.anthropic?.accessToken || null;
      const refreshToken = snapshot?.anthropic?.refreshToken || null;
      const expiresAt = snapshot?.anthropic?.expiresAt || null;

      const isConnected = !!(accessToken && refreshToken && expiresAt);

      logger.info('[ClaudeOAuth] Initialized', { isConnected });

      set({
        accessToken,
        refreshToken,
        expiresAt,
        isConnected,
        isLoading: false,
        isInitialized: true,
      });
    } catch (error) {
      logger.error('[ClaudeOAuth] Initialization error:', error);
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
        isLoading: false,
      });

      logger.info('[ClaudeOAuth] OAuth flow started');
      return result.url;
    } catch (error) {
      logger.error('[ClaudeOAuth] Failed to start OAuth:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to start OAuth',
        isLoading: false,
      });
      throw error;
    }
  },

  // Complete OAuth flow with authorization code
  completeOAuth: async (code: string) => {
    const { verifier } = get();

    if (!verifier) {
      throw new Error('No verifier found. Please start OAuth flow first.');
    }

    set({ isLoading: true, error: null });

    try {
      const result = await exchangeCode(code, verifier);

      if (result.type === 'failed' || !result.tokens) {
        throw new Error(result.error || 'Token exchange failed');
      }

      const { accessToken, refreshToken, expiresAt } = result.tokens;

      logger.info('[ClaudeOAuth] OAuth completed successfully');

      set({
        accessToken,
        refreshToken,
        expiresAt,
        isConnected: true,
        verifier: null,
        isLoading: false,
      });
    } catch (error) {
      logger.error('[ClaudeOAuth] Failed to complete OAuth:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to complete OAuth',
        verifier: null,
        isLoading: false,
      });
      throw error;
    }
  },

  // Disconnect and clear tokens
  disconnect: async () => {
    set({ isLoading: true, error: null });

    try {
      await llmClient.disconnectClaudeOAuth();

      logger.info('[ClaudeOAuth] Disconnected');

      set({
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        isConnected: false,
        isLoading: false,
      });
    } catch (error) {
      logger.error('[ClaudeOAuth] Failed to disconnect:', error);
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
      logger.info('[ClaudeOAuth] Token expired, refreshing...');
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
        logger.error('[ClaudeOAuth] Token refresh failed:', result.error);
        // Clear tokens on refresh failure
        await get().disconnect();
        return false;
      }

      const { accessToken, refreshToken: newRefreshToken, expiresAt: newExpiresAt } = result.tokens;

      logger.info('[ClaudeOAuth] Token refreshed successfully');

      set({
        accessToken,
        refreshToken: newRefreshToken,
        expiresAt: newExpiresAt,
      });

      return true;
    } catch (error) {
      logger.error('[ClaudeOAuth] Token refresh error:', error);
      return false;
    }
  },
}));

// Selector for connection status
export const selectIsClaudeOAuthConnected = (state: ClaudeOAuthStore) => state.isConnected;

// Export async helper for checking OAuth status
export async function isClaudeOAuthConnected(): Promise<boolean> {
  const store = useClaudeOAuthStore.getState();
  if (!store.isInitialized) {
    await store.initialize();
  }
  return useClaudeOAuthStore.getState().isConnected;
}

// Export async helper for getting valid access token
export async function getClaudeOAuthAccessToken(): Promise<string | null> {
  const store = useClaudeOAuthStore.getState();
  if (!store.isInitialized) {
    await store.initialize();
  }
  return useClaudeOAuthStore.getState().getValidAccessToken();
}
