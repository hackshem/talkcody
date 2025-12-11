import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from '@/types/models';

// Mock dependencies before importing the service
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'appdata' },
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock('@/services/custom-provider-service', () => ({
  customProviderService: {
    getEnabledCustomProviders: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/stores/settings-store', () => ({
  settingsManager: {
    getProviderApiKey: vi.fn(),
    getProviderBaseUrl: vi.fn(),
  },
}));

vi.mock('@/providers/provider_config', () => ({
  PROVIDER_CONFIGS: {
    anthropic: { name: 'Anthropic' },
    openai: { name: 'OpenAI' },
  },
}));

describe('CustomModelService - fetchProviderModels with custom base URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use custom base URL when configured for anthropic', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { settingsManager } = await import('@/stores/settings-store');
    const { customModelService } = await import('./custom-model-service');

    // Setup mocks
    vi.mocked(settingsManager.getProviderApiKey).mockReturnValue('test-api-key');
    vi.mocked(settingsManager.getProviderBaseUrl).mockResolvedValue('https://custom-proxy.com/v1');
    vi.mocked(invoke).mockResolvedValue({
      status: 200,
      body: JSON.stringify({ data: [{ id: 'claude-3', name: 'Claude 3' }] }),
    });

    await customModelService.fetchProviderModels('anthropic');

    // Verify invoke was called with the custom URL
    expect(invoke).toHaveBeenCalledWith('proxy_fetch', {
      request: expect.objectContaining({
        url: 'https://custom-proxy.com/v1/models',
        method: 'GET',
      }),
    });
  });

  it('should use custom base URL when configured for openai', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { settingsManager } = await import('@/stores/settings-store');
    const { customModelService } = await import('./custom-model-service');

    vi.mocked(settingsManager.getProviderApiKey).mockReturnValue('test-api-key');
    vi.mocked(settingsManager.getProviderBaseUrl).mockResolvedValue('https://my-openai-proxy.com/v1/');
    vi.mocked(invoke).mockResolvedValue({
      status: 200,
      body: JSON.stringify({ data: [{ id: 'gpt-4', name: 'GPT-4' }] }),
    });

    await customModelService.fetchProviderModels('openai');

    // Verify trailing slashes are handled correctly
    expect(invoke).toHaveBeenCalledWith('proxy_fetch', {
      request: expect.objectContaining({
        url: 'https://my-openai-proxy.com/v1/models',
        method: 'GET',
      }),
    });
  });

  it('should use default endpoint when no custom base URL is configured', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { settingsManager } = await import('@/stores/settings-store');
    const { customModelService } = await import('./custom-model-service');

    vi.mocked(settingsManager.getProviderApiKey).mockReturnValue('test-api-key');
    vi.mocked(settingsManager.getProviderBaseUrl).mockResolvedValue(null);
    vi.mocked(invoke).mockResolvedValue({
      status: 200,
      body: JSON.stringify({ data: [{ id: 'claude-3', name: 'Claude 3' }] }),
    });

    await customModelService.fetchProviderModels('anthropic');

    // Verify default endpoint is used
    expect(invoke).toHaveBeenCalledWith('proxy_fetch', {
      request: expect.objectContaining({
        url: 'https://api.anthropic.com/v1/models',
        method: 'GET',
      }),
    });
  });

  it('should handle multiple trailing slashes in custom base URL', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { settingsManager } = await import('@/stores/settings-store');
    const { customModelService } = await import('./custom-model-service');

    vi.mocked(settingsManager.getProviderApiKey).mockReturnValue('test-api-key');
    vi.mocked(settingsManager.getProviderBaseUrl).mockResolvedValue('https://proxy.com/v1///');
    vi.mocked(invoke).mockResolvedValue({
      status: 200,
      body: JSON.stringify({ data: [] }),
    });

    await customModelService.fetchProviderModels('anthropic');

    expect(invoke).toHaveBeenCalledWith('proxy_fetch', {
      request: expect.objectContaining({
        url: 'https://proxy.com/v1/models',
      }),
    });
  });

  it('should include anthropic-specific headers with custom base URL', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { settingsManager } = await import('@/stores/settings-store');
    const { customModelService } = await import('./custom-model-service');

    vi.mocked(settingsManager.getProviderApiKey).mockReturnValue('my-api-key');
    vi.mocked(settingsManager.getProviderBaseUrl).mockResolvedValue('https://custom-anthropic.com/v1');
    vi.mocked(invoke).mockResolvedValue({
      status: 200,
      body: JSON.stringify({ data: [] }),
    });

    await customModelService.fetchProviderModels('anthropic');

    expect(invoke).toHaveBeenCalledWith('proxy_fetch', {
      request: expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'my-api-key',
          'anthropic-version': '2023-06-01',
        }),
      }),
    });
  });
});

describe('CustomModelService - addCustomModel provider merging', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('should merge providers when adding a model with same ID via addCustomModel', async () => {
    const { exists, readTextFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
    const { customModelService } = await import('./custom-model-service');

    // Setup: existing model with provider A
    const existingConfig = {
      version: 'custom',
      models: {
        'test-model': {
          name: 'Test Model',
          providers: ['providerA'],
          pricing: { input: '0', output: '0' },
        },
      },
    };

    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(existingConfig));
    vi.mocked(writeTextFile).mockResolvedValue();

    // Clear cache to force re-read
    customModelService.clearCache();

    // Add same model with provider B
    const newConfig: ModelConfig = {
      name: 'Test Model',
      providers: ['providerB'],
      pricing: { input: '0', output: '0' },
    };

    await customModelService.addCustomModel('test-model', newConfig);

    // Verify writeTextFile was called with merged providers
    expect(writeTextFile).toHaveBeenCalled();
    const savedContent = vi.mocked(writeTextFile).mock.calls[0][1];
    const savedConfig = JSON.parse(savedContent);

    expect(savedConfig.models['test-model'].providers).toEqual(['providerA', 'providerB']);
  });

  it('should merge providers when adding a model with same ID via addCustomModels', async () => {
    const { exists, readTextFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
    const { customModelService } = await import('./custom-model-service');

    // Setup: existing model with provider A
    const existingConfig = {
      version: 'custom',
      models: {
        'test-model': {
          name: 'Test Model',
          providers: ['providerA'],
          pricing: { input: '0', output: '0' },
        },
      },
    };

    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(existingConfig));
    vi.mocked(writeTextFile).mockResolvedValue();

    // Clear cache to force re-read
    customModelService.clearCache();

    // Add same model with provider B
    const newModels: Record<string, ModelConfig> = {
      'test-model': {
        name: 'Test Model',
        providers: ['providerB'],
        pricing: { input: '0', output: '0' },
      },
    };

    await customModelService.addCustomModels(newModels);

    // Verify writeTextFile was called with merged providers
    expect(writeTextFile).toHaveBeenCalled();
    const savedContent = vi.mocked(writeTextFile).mock.calls[0][1];
    const savedConfig = JSON.parse(savedContent);

    expect(savedConfig.models['test-model'].providers).toEqual(['providerA', 'providerB']);
  });

  it('should merge providerMappings when adding a model with same ID', async () => {
    const { exists, readTextFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
    const { customModelService } = await import('./custom-model-service');

    // Setup: existing model with provider A and its mapping
    const existingConfig = {
      version: 'custom',
      models: {
        'test-model': {
          name: 'Test Model',
          providers: ['providerA'],
          providerMappings: { providerA: 'model-name-on-A' },
          pricing: { input: '0', output: '0' },
        },
      },
    };

    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(existingConfig));
    vi.mocked(writeTextFile).mockResolvedValue();

    // Clear cache to force re-read
    customModelService.clearCache();

    // Add same model with provider B and its mapping
    const newConfig: ModelConfig = {
      name: 'Test Model',
      providers: ['providerB'],
      providerMappings: { providerB: 'model-name-on-B' },
      pricing: { input: '0', output: '0' },
    };

    await customModelService.addCustomModel('test-model', newConfig);

    // Verify writeTextFile was called with merged providerMappings
    expect(writeTextFile).toHaveBeenCalled();
    const savedContent = vi.mocked(writeTextFile).mock.calls[0][1];
    const savedConfig = JSON.parse(savedContent);

    expect(savedConfig.models['test-model'].providers).toEqual(['providerA', 'providerB']);
    expect(savedConfig.models['test-model'].providerMappings).toEqual({
      providerA: 'model-name-on-A',
      providerB: 'model-name-on-B',
    });
  });

  it('should not duplicate providers when adding same provider twice', async () => {
    const { exists, readTextFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
    const { customModelService } = await import('./custom-model-service');

    // Setup: existing model with provider A
    const existingConfig = {
      version: 'custom',
      models: {
        'test-model': {
          name: 'Test Model',
          providers: ['providerA'],
          pricing: { input: '0', output: '0' },
        },
      },
    };

    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(existingConfig));
    vi.mocked(writeTextFile).mockResolvedValue();

    // Clear cache to force re-read
    customModelService.clearCache();

    // Add same model with same provider A again
    const newConfig: ModelConfig = {
      name: 'Test Model',
      providers: ['providerA'],
      pricing: { input: '0', output: '0' },
    };

    await customModelService.addCustomModel('test-model', newConfig);

    // Verify writeTextFile was called with deduplicated providers
    expect(writeTextFile).toHaveBeenCalled();
    const savedContent = vi.mocked(writeTextFile).mock.calls[0][1];
    const savedConfig = JSON.parse(savedContent);

    expect(savedConfig.models['test-model'].providers).toEqual(['providerA']);
  });

  it('should create new model when model ID does not exist', async () => {
    const { exists, readTextFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
    const { customModelService } = await import('./custom-model-service');

    // Setup: empty config
    const existingConfig = {
      version: 'custom',
      models: {},
    };

    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(existingConfig));
    vi.mocked(writeTextFile).mockResolvedValue();

    // Clear cache to force re-read
    customModelService.clearCache();

    // Add new model
    const newConfig: ModelConfig = {
      name: 'New Model',
      providers: ['providerA'],
      pricing: { input: '0', output: '0' },
    };

    await customModelService.addCustomModel('new-model', newConfig);

    // Verify writeTextFile was called with the new model
    expect(writeTextFile).toHaveBeenCalled();
    const savedContent = vi.mocked(writeTextFile).mock.calls[0][1];
    const savedConfig = JSON.parse(savedContent);

    expect(savedConfig.models['new-model']).toEqual(newConfig);
  });

  it('should handle merging multiple models at once with addCustomModels', async () => {
    const { exists, readTextFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
    const { customModelService } = await import('./custom-model-service');

    // Setup: existing models
    const existingConfig = {
      version: 'custom',
      models: {
        'model-1': {
          name: 'Model 1',
          providers: ['providerA'],
          pricing: { input: '0', output: '0' },
        },
        'model-2': {
          name: 'Model 2',
          providers: ['providerA'],
          pricing: { input: '0', output: '0' },
        },
      },
    };

    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(existingConfig));
    vi.mocked(writeTextFile).mockResolvedValue();

    // Clear cache to force re-read
    customModelService.clearCache();

    // Add: merge model-1, create model-3
    const newModels: Record<string, ModelConfig> = {
      'model-1': {
        name: 'Model 1',
        providers: ['providerB'],
        pricing: { input: '0', output: '0' },
      },
      'model-3': {
        name: 'Model 3',
        providers: ['providerC'],
        pricing: { input: '0', output: '0' },
      },
    };

    await customModelService.addCustomModels(newModels);

    // Verify
    expect(writeTextFile).toHaveBeenCalled();
    const savedContent = vi.mocked(writeTextFile).mock.calls[0][1];
    const savedConfig = JSON.parse(savedContent);

    // model-1 should have merged providers
    expect(savedConfig.models['model-1'].providers).toEqual(['providerA', 'providerB']);
    // model-2 should be unchanged
    expect(savedConfig.models['model-2'].providers).toEqual(['providerA']);
    // model-3 should be newly created
    expect(savedConfig.models['model-3'].providers).toEqual(['providerC']);
  });
});
