// src/types/provider.ts
/**
 * Provider type definitions
 */

import type { CustomProviderConfig } from './custom-provider';

export type ProviderType =
  | 'openai'
  | 'openai-compatible'
  | 'custom'
  | 'custom-openai'
  | 'custom-anthropic';

export interface ProviderDefinition {
  id: string;
  name: string;
  priority: number;
  apiKeyName: string;
  baseUrl?: string;
  required?: boolean;
  type: ProviderType;
  createProvider?: (apiKey: string, baseUrl?: string) => any;
  isCustom?: boolean;
  customConfig?: CustomProviderConfig;
  /** Whether this provider supports Coding Plan feature */
  supportsCodingPlan?: boolean;
  /** Custom base URL to use when Coding Plan is enabled */
  codingPlanBaseUrl?: string;
}

export interface ProviderRegistry {
  [key: string]: ProviderDefinition;
}

// Extended provider definition that includes custom providers
export interface ExtendedProviderDefinition extends ProviderDefinition {
  isCustom?: boolean;
  customConfig?: CustomProviderConfig;
}

// Provider creation context for custom providers
export interface ProviderCreationContext {
  apiKey: string;
  baseUrl?: string;
  customConfig?: CustomProviderConfig;
}
