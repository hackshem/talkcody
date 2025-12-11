// src/hooks/use-toolbar-state.ts
/**
 * Shared hook for toolbar state - model name and task usage data
 */

import { useCallback, useEffect, useState } from 'react';
import { logger } from '@/lib/logger';
import { modelService, useProviderStore } from '@/stores/provider-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useTaskStore } from '@/stores/task-store';

// Formatting utilities
export function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toString();
}

export function formatCost(costValue: number): string {
  return `$${costValue.toFixed(4)}`;
}

export function getContextUsageColor(usage: number): string {
  if (usage >= 90) return 'text-red-600 dark:text-red-400';
  if (usage >= 70) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-emerald-600 dark:text-emerald-400';
}

export function getContextUsageBgColor(usage: number): string {
  if (usage >= 90) return 'bg-red-100 dark:bg-red-900/30';
  if (usage >= 70) return 'bg-yellow-100 dark:bg-yellow-900/30';
  return 'bg-emerald-100 dark:bg-emerald-900/30';
}

export interface ToolbarState {
  modelName: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  contextUsage: number;
}

export function useToolbarState(): ToolbarState {
  const [modelName, setModelName] = useState<string>('');

  // Get current task usage from task store
  const currentTask = useTaskStore((state) =>
    state.currentTaskId ? state.tasks.get(state.currentTaskId) : undefined
  );
  const cost = currentTask?.cost ?? 0;
  const inputTokens = currentTask?.input_token ?? 0;
  const outputTokens = currentTask?.output_token ?? 0;
  const contextUsage = currentTask?.context_usage ?? 0;

  // Subscribe to settings store for reactive updates
  const {
    model_type_main,
    model_type_small,
    model_type_image_generator,
    model_type_transcription,
    assistantId,
  } = useSettingsStore();

  // Get available models from store
  const availableModels = useProviderStore((state) => state.availableModels);

  // Fetch current model identifier and format display name
  const updateModelName = useCallback(async () => {
    try {
      const modelIdentifier = await modelService.getCurrentModel();
      if (!modelIdentifier) {
        setModelName('');
        return;
      }

      // Parse "modelKey@providerId" format
      const [modelKey, providerId] = modelIdentifier.split('@');

      // Find the model in available models to get display name and provider name
      const model = availableModels.find(
        (m) => m.key === modelKey && (!providerId || m.provider === providerId)
      );

      if (model) {
        // Display as "ModelName@ProviderName" for better readability
        setModelName(`${model.name}@${model.providerName}`);
      } else {
        // Fallback to raw identifier if model not found
        setModelName(modelIdentifier);
      }
    } catch (error) {
      logger.error('Failed to get current model:', error);
      setModelName('');
    }
  }, [availableModels]);

  // Update model name when model type settings change
  // biome-ignore lint/correctness/useExhaustiveDependencies: These dependencies trigger re-fetch when model settings change in the store
  useEffect(() => {
    updateModelName();
  }, [
    updateModelName,
    model_type_main,
    model_type_small,
    model_type_image_generator,
    model_type_transcription,
    assistantId,
  ]);

  // Also listen for other events (modelsUpdated, settingsChanged)
  useEffect(() => {
    const handleModelsUpdate = () => {
      updateModelName();
    };

    const handleSettingsChange = () => {
      updateModelName();
    };

    window.addEventListener('modelsUpdated', handleModelsUpdate);
    window.addEventListener('settingsChanged', handleSettingsChange);

    return () => {
      window.removeEventListener('modelsUpdated', handleModelsUpdate);
      window.removeEventListener('settingsChanged', handleSettingsChange);
    };
  }, [updateModelName]);

  return {
    modelName,
    cost,
    inputTokens,
    outputTokens,
    contextUsage,
  };
}
