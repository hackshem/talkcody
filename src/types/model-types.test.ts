import { describe, expect, it, vi } from 'vitest';

vi.mock('@/providers/config/model-config', () => {
  throw new Error('model-config should not be imported by model-types');
});

describe('model-types', () => {
  it('loads without importing model-config', async () => {
    const module = await import('@/types/model-types');
    expect(module.DEFAULT_MODELS_BY_TYPE).toBeDefined();
  });

  it('maps default model types to the constant values', async () => {
    const { DEFAULT_MODELS_BY_TYPE, ModelType } = await import('@/types/model-types');
    const constants = await import('@/providers/config/model-constants');

    expect(DEFAULT_MODELS_BY_TYPE[ModelType.MAIN]).toBe(constants.MINIMAX_M21);
    expect(DEFAULT_MODELS_BY_TYPE[ModelType.SMALL]).toBe(constants.GEMINI_25_FLASH_LITE);
    expect(DEFAULT_MODELS_BY_TYPE[ModelType.IMAGE_GENERATOR]).toBe(constants.NANO_BANANA_PRO);
    expect(DEFAULT_MODELS_BY_TYPE[ModelType.TRANSCRIPTION]).toBe(constants.SCRIBE_V2_REALTIME);
    expect(DEFAULT_MODELS_BY_TYPE[ModelType.MESSAGE_COMPACTION]).toBe(constants.GEMINI_25_FLASH_LITE);
    expect(DEFAULT_MODELS_BY_TYPE[ModelType.PLAN]).toBe(constants.MINIMAX_M21);
    expect(DEFAULT_MODELS_BY_TYPE[ModelType.CODE_REVIEW]).toBe(constants.MINIMAX_M21);
  });
});
