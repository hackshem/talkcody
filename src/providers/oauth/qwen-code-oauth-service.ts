// src/providers/oauth/qwen-code-oauth-service.ts
// Service for Qwen Code OAuth operations (Rust-backed).

import { logger } from '@/lib/logger';
import { llmClient } from '@/services/llm/llm-client';

// Qwen OAuth credentials interface
export interface QwenCredentials {
  access_token: string;
  refresh_token: string;
  token_type: string;
  resource_url: string;
  expiry_date: number;
}

/**
 * Read and parse credentials from file (delegated to Rust).
 */
export async function readCredentialsFromFile(path: string): Promise<QwenCredentials> {
  return llmClient.readQwenCredentials({ path });
}

/**
 * Read token from a file path with automatic refresh if expired (delegated to Rust).
 */
export async function readTokenFromPath(path: string): Promise<string> {
  try {
    return await llmClient.readQwenToken({ path });
  } catch (error) {
    logger.error('[QwenOAuth] Failed to read token:', error);
    throw error;
  }
}

/**
 * Validate that a token path exists and is readable (delegated to Rust).
 */
export async function validateTokenPath(path: string): Promise<boolean> {
  try {
    return await llmClient.validateQwenTokenPath({ path });
  } catch (error) {
    logger.error('[QwenOAuth] Token path validation failed:', error);
    return false;
  }
}

/**
 * Test if a token is valid by making a simple API request (delegated to Rust).
 */
export async function testToken(token: string): Promise<boolean> {
  try {
    return await llmClient.testQwenToken({ token });
  } catch (error) {
    logger.error('[QwenOAuth] Token test failed:', error);
    return false;
  }
}
