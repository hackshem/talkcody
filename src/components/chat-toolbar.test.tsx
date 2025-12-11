// src/components/chat-toolbar.test.tsx
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock useToolbarState hook
const mockUseToolbarState = vi.fn();
vi.mock('@/hooks/use-toolbar-state', () => ({
  useToolbarState: () => mockUseToolbarState(),
}));

// Mock model service
const mockGetCurrentModel = vi.fn();
vi.mock('@/services/model-service', () => ({
  modelService: {
    getCurrentModel: () => mockGetCurrentModel(),
  },
}));

// Create a mock Zustand store
const mockUseSettingsStore = vi.fn();
vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: () => mockUseSettingsStore(),
}));

// Mock database service
vi.mock('@/services/database-service', () => ({
  databaseService: {
    getProjects: vi.fn(() => Promise.resolve([])),
  },
}));

// Import the component after mocks
import { ChatToolbar } from './chat-toolbar';

describe('ChatToolbar - Model Name Real-time Update', () => {
  const defaultProps = {
    currentConversationId: 'test-conv-1',
    isHistoryOpen: false,
    onHistoryOpenChange: vi.fn(),
    onConversationSelect: vi.fn(),
    onNewChat: vi.fn(),
    currentProjectId: 'default',
    onProjectSelect: vi.fn().mockResolvedValue(undefined),
    onImportRepository: vi.fn().mockResolvedValue(undefined),
    isLoadingProject: false,
    rootPath: '/test/path',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default toolbar state
    mockUseToolbarState.mockReturnValue({
      modelName: 'claude-3-sonnet@anthropic',
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
      contextUsage: null,
    });

    // Default store state
    mockUseSettingsStore.mockReturnValue({
      model_type_main: 'claude-3-sonnet@anthropic',
      model_type_small: 'gpt-4o-mini@openai',
      model_type_image_generator: '',
      model_type_transcription: '',
      assistantId: 'planner',
    });

    // Default model service response
    mockGetCurrentModel.mockResolvedValue('claude-3-sonnet@anthropic');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should display the current model name on mount', async () => {
    render(<ChatToolbar {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('claude-3-sonnet@anthropic')).toBeInTheDocument();
    });
  });

  it('should update model name when model_type_main changes in store', async () => {
    const { rerender } = render(<ChatToolbar {...defaultProps} />);

    // Initial render shows first model
    await waitFor(() => {
      expect(screen.getByText('claude-3-sonnet@anthropic')).toBeInTheDocument();
    });

    // Update toolbar state with new model name
    mockUseToolbarState.mockReturnValue({
      modelName: 'gpt-4o@openai',
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
      contextUsage: null,
    });

    // Re-render to trigger update
    rerender(<ChatToolbar {...defaultProps} />);

    // Should display new model name
    await waitFor(() => {
      expect(screen.getByText('gpt-4o@openai')).toBeInTheDocument();
    });
  });

  it('should update model name when provider changes for same model', async () => {
    const { rerender } = render(<ChatToolbar {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('claude-3-sonnet@anthropic')).toBeInTheDocument();
    });

    // Update toolbar state with new provider
    mockUseToolbarState.mockReturnValue({
      modelName: 'claude-3-sonnet@openrouter',
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
      contextUsage: null,
    });

    rerender(<ChatToolbar {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('claude-3-sonnet@openrouter')).toBeInTheDocument();
    });
  });

  it('should update model name when assistantId changes', async () => {
    const { rerender } = render(<ChatToolbar {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('claude-3-sonnet@anthropic')).toBeInTheDocument();
    });

    // Update toolbar state with different model for new assistant
    mockUseToolbarState.mockReturnValue({
      modelName: 'gpt-4o-mini@openai',
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
      contextUsage: null,
    });

    rerender(<ChatToolbar {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('gpt-4o-mini@openai')).toBeInTheDocument();
    });
  });

  it('should not trigger update when unrelated store values change', async () => {
    const { rerender } = render(<ChatToolbar {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('claude-3-sonnet@anthropic')).toBeInTheDocument();
    });

    // Re-render with same toolbar state
    rerender(<ChatToolbar {...defaultProps} />);

    // Model name should remain the same
    await waitFor(() => {
      expect(screen.getByText('claude-3-sonnet@anthropic')).toBeInTheDocument();
    });
  });

  it('should handle empty model name', async () => {
    mockUseToolbarState.mockReturnValue({
      modelName: '',
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
      contextUsage: null,
    });

    render(<ChatToolbar {...defaultProps} />);

    // Wait for the component to settle
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Model badge should not be displayed when model name is empty
    expect(screen.queryByText('Model:')).not.toBeInTheDocument();
  });
});
