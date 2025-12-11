export const GPT5_MINI = 'gpt-5-mini';
export const GPT51_CODE_MAX = 'gpt-51-codex-max';
export const GEMINI_25_FLASH_LITE = 'gemini-2.5-flash-lite';
export const CODE_STARL = 'codestral';
export const CLAUDE_HAIKU = 'claude-haiku-4.5';
export const GROK_CODE_FAST = 'grok-code-fast-1';
export const NANO_BANANA_PRO = 'gemini-3-pro-image';
export const SCRIBE_V2_REALTIME = 'scribe-v2-realtime';

import { logger } from '@/lib/logger';
import { modelLoader } from '@/lib/model-loader';
import { providerRegistry } from '@/providers';
import type { ProviderConfig } from '@/types/api-keys';
import type { ModelConfig as ModelConfigType } from '@/types/models';

// Dynamic model configs loaded from JSON
let MODEL_CONFIGS: Record<string, ModelConfigType> = {};

// Promise to track initialization status
let initPromise: Promise<void> | null = null;

// Initialize models from loader
async function initializeModels(): Promise<void> {
  try {
    const config = await modelLoader.load();
    MODEL_CONFIGS = config.models;
  } catch (error) {
    logger.error('Failed to load models:', error);
    // Fallback to empty object - will use default configs
    MODEL_CONFIGS = {};
  }
}

/**
 * Ensure models are initialized before use
 * Call this before accessing MODEL_CONFIGS to avoid race conditions
 */
export function ensureModelsInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = initializeModels();
  }
  return initPromise;
}

// Initialize on module load
initPromise = initializeModels();

// Refresh model configs - used for hot-reload
export async function refreshModelConfigs(): Promise<void> {
  try {
    // Clear memory cache to force reload from file/remote
    modelLoader.clearCache();
    const config = await modelLoader.load();
    // Update the MODEL_CONFIGS object in-place to maintain references
    for (const key of Object.keys(MODEL_CONFIGS)) {
      delete MODEL_CONFIGS[key];
    }
    Object.assign(MODEL_CONFIGS, config.models);
    logger.info('Model configs refreshed successfully');
  } catch (error) {
    logger.error('Failed to refresh model configs:', error);
  }
}

// Export MODEL_CONFIGS for backward compatibility
export { MODEL_CONFIGS };

export type ModelKey = string;

// Import provider types from the new registry system
export type { ProviderIds as ProviderType } from '@/providers';

// Re-export ModelConfig from types
export type { ModelConfig } from '@/types/models';

// Get providers for a model
export function getProvidersForModel(model: string): ProviderConfig[] {
  const modelKey = model.split('@')[0] || model;
  const config = MODEL_CONFIGS[modelKey as ModelKey];
  if (!config || !config.providers) return [];
  return config.providers
    .map((id) => providerRegistry.getProvider(String(id)))
    .filter((p) => p !== undefined) as ProviderConfig[];
}

// Get context length for a model
export function getContextLength(model: string): number {
  // Parse model identifier to extract modelKey (remove @providerId suffix)
  const modelKey = model.split('@')[0] || model;
  const config = MODEL_CONFIGS[modelKey as ModelKey];
  logger.info(`Context length for model ${model}: ${config?.context_length}`);
  return config?.context_length ?? 200000; // Default fallback
}
