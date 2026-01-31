// src/providers/oauth/claude-oauth-service.ts
// Core OAuth service for Claude Pro/Max authentication (Rust-backed).

import { logger } from '@/lib/logger';
import { llmClient } from '@/services/llm/llm-client';

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

export const CLAUDE_OAUTH_BETA_HEADERS =
  'oauth-2025-04-20,claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14';

export interface ClaudeOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
}

export interface OAuthFlowResult {
  url: string;
  verifier: string;
}

export interface TokenExchangeResult {
  type: 'success' | 'failed';
  tokens?: ClaudeOAuthTokens;
  error?: string;
}

/**
 * Start OAuth flow - generates authorization URL via Rust.
 */
export async function startOAuthFlow(): Promise<OAuthFlowResult> {
  logger.info('[ClaudeOAuth] Starting OAuth flow via Rust');
  return llmClient.startClaudeOAuth();
}

/**
 * Exchange authorization code for tokens via Rust.
 */
export async function exchangeCode(code: string, verifier: string): Promise<TokenExchangeResult> {
  try {
    logger.info('[ClaudeOAuth] Exchanging code via Rust');
    const tokens = await llmClient.completeClaudeOAuth({ code, verifier });
    return { type: 'success', tokens };
  } catch (error) {
    logger.error('[ClaudeOAuth] Token exchange error:', error);
    return {
      type: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Refresh an expired access token via Rust.
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenExchangeResult> {
  try {
    logger.info('[ClaudeOAuth] Refreshing access token via Rust');
    const tokens = await llmClient.refreshClaudeOAuth({ refreshToken });
    return { type: 'success', tokens };
  } catch (error) {
    logger.error('[ClaudeOAuth] Token refresh error:', error);
    return {
      type: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check if token is expired or about to expire (within 1 minute)
 */
export function isTokenExpired(expiresAt: number): boolean {
  const bufferMs = 60 * 1000; // 1 minute buffer
  return Date.now() + bufferMs >= expiresAt;
}

/**
 * Get OAuth client ID (for display purposes)
 */
export function getClientId(): string {
  return CLIENT_ID;
}
