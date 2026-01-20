// TalkCody provider - Free AI provider for TalkCody users
// Uses JWT token authentication (requires GitHub/Google login)

import { createAnthropic } from '@ai-sdk/anthropic';
import { API_BASE_URL } from '@/lib/config';
import { streamFetch } from '@/lib/tauri-fetch';
import { secureStorage } from '@/services/secure-storage';

/**
 * Create authenticated fetch function for TalkCody provider
 * Uses JWT token from user authentication
 */
function createAuthenticatedFetch(): (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response> {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Get JWT token from secure storage
    const token = await secureStorage.getAuthToken();

    if (!token) {
      throw new Error(
        'Authentication required. Please sign in with GitHub or Google to use TalkCody Free.'
      );
    }

    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);

    return streamFetch(input, {
      ...init,
      headers,
    });
  };
}

/**
 * Create TalkCody provider instance (synchronous)
 * Uses Anthropic protocol with JWT authentication
 */
export function createTalkCodyProvider(): ReturnType<typeof createAnthropic> {
  const baseURL = `${API_BASE_URL}/api/talkcody/v1`;

  return createAnthropic({
    apiKey: 'talkcody-internal', // Not used, auth is via JWT token
    baseURL,
    fetch: createAuthenticatedFetch() as typeof fetch,
  });
}
