// src/providers/custom-provider-factory.ts
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { logger } from '@/lib/logger';
import { streamFetch } from '@/lib/tauri-fetch';
import type { CustomProviderConfig } from '@/types/custom-provider';

/**
 * Factory function to create custom providers
 */
export function createCustomProvider(
  config: CustomProviderConfig,
  apiKey: string,
  baseUrl?: string
) {
  let finalBaseUrl = baseUrl || config.baseUrl;

  // For anthropic type, auto-append /v1 if not already present
  if (config.type === 'anthropic' && finalBaseUrl && !finalBaseUrl.endsWith('/v1')) {
    finalBaseUrl = `${finalBaseUrl.replace(/\/$/, '')}/v1`;
  }

  logger.info('Creating custom provider:', {
    id: config.id,
    name: config.name,
    type: config.type,
    baseUrl: finalBaseUrl,
  });

  if (config.type === 'anthropic') {
    return createAnthropic({
      apiKey,
      baseURL: finalBaseUrl,
      fetch: streamFetch as typeof fetch,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
  } else {
    return createOpenAICompatible({
      apiKey,
      name: config.name,
      baseURL: finalBaseUrl,
      fetch: streamFetch as typeof fetch,
    });
  }
}
