// src/hooks/use-tasks.ts

import { useCallback, useMemo, useState } from 'react';
import { logger } from '@/lib/logger';
import { databaseService } from '@/services/database-service';
import { taskService } from '@/services/task-service';
import { settingsManager } from '@/stores/settings-store';
import { useTaskStore } from '@/stores/task-store';
import { useUIStateStore } from '@/stores/ui-state-store';

// Re-export Conversation type from database types
export type { Task as Conversation } from '@/types';

// Import for local use
import type { Task } from '@/types';

export function useTasks(onTaskStart?: (conversationId: string, title: string) => void) {
  const [error, setError] = useState<string | null>(null);

  // Get tasks Map from TaskStore (stable reference)
  const tasks = useTaskStore((state) => state.tasks);
  const currentTaskId = useTaskStore((state) => state.currentTaskId);
  const loadingTasks = useTaskStore((state) => state.loadingTasks);

  // Derive task list with memoization to avoid infinite loops
  const conversations = useMemo(() => {
    const list = Array.from(tasks.values());
    return list.sort((a, b) => b.updated_at - a.updated_at);
  }, [tasks]);
  // Convert null to undefined for backward compatibility
  const currentConversationId = currentTaskId ?? undefined;

  // UI state for editing
  const editingTaskId = useUIStateStore((state) => state.editingTaskId);
  const editingTitle = useUIStateStore((state) => state.editingTitle);
  const setEditingTitle = useUIStateStore((state) => state.setEditingTitle);
  const startEditingUI = useUIStateStore((state) => state.startEditing);
  const cancelEditingUI = useUIStateStore((state) => state.cancelEditing);
  const finishEditingUI = useUIStateStore((state) => state.finishEditing);

  // Load conversations
  const loadTasks = useCallback(async (projectId?: string) => {
    try {
      await taskService.loadTasks(projectId);
    } catch (err) {
      logger.error('Failed to load conversations:', err);
      setError('Failed to load conversations');
    }
  }, []);

  const loadTask = useCallback(
    async (convId: string, onMessagesLoaded?: (messages: any[]) => void) => {
      try {
        const messages = await taskService.loadMessages(convId);
        onMessagesLoaded?.(messages);
        useTaskStore.getState().setCurrentTaskId(convId);
        settingsManager.setCurrentConversationId(convId);
      } catch (err) {
        logger.error('Failed to load conversation:', err);
        setError('Failed to load conversation');
      }
    },
    []
  );

  // Create conversation
  const createTask = useCallback(
    async (userMessage: string): Promise<string> => {
      const taskId = await taskService.createTask(userMessage, {
        onTaskStart: onTaskStart,
      });
      return taskId;
    },
    [onTaskStart]
  );

  // Select conversation
  const selectConversation = useCallback(async (convId: string) => {
    await taskService.selectTask(convId);
  }, []);

  // Set current conversation ID
  const setCurrentConversationId = useCallback((convId: string | undefined) => {
    useTaskStore.getState().setCurrentTaskId(convId || null);
    if (convId) {
      settingsManager.setCurrentConversationId(convId);
    }
  }, []);

  // Delete conversation
  const deleteConversation = useCallback(async (convId: string) => {
    await taskService.deleteTask(convId);
  }, []);

  // Save message (for backward compatibility)
  const saveMessage = useCallback(
    async (
      convId: string,
      role: string,
      content: string,
      positionIndex: number,
      agentId?: string,
      attachments?: any[]
    ) => {
      await databaseService.saveMessage(
        convId,
        role as 'user' | 'assistant' | 'tool',
        content,
        positionIndex,
        agentId,
        attachments
      );
    },
    []
  );

  // Clear conversation state
  const clearConversation = useCallback(() => {
    useTaskStore.getState().setCurrentTaskId(null);
  }, []);

  // Get conversation details
  const getConversationDetails = useCallback(async (convId: string) => {
    return await databaseService.getConversationDetails(convId);
  }, []);

  // Start new chat
  const startNewChat = useCallback(() => {
    taskService.startNewChat();
  }, []);

  // Editing functions
  const startEditing = useCallback(
    (conv: Task, e?: React.MouseEvent) => {
      const task = useTaskStore.getState().getTask(conv.id);
      if (task) {
        startEditingUI(task, e);
      }
    },
    [startEditingUI]
  );

  const cancelEditing = useCallback(() => {
    cancelEditingUI();
  }, [cancelEditingUI]);

  const finishEditing = useCallback(async () => {
    const result = finishEditingUI();
    if (result) {
      await taskService.renameTask(result.taskId, result.title);
    }
  }, [finishEditingUI]);

  return {
    // Data
    conversations,
    currentConversationId,
    loading: loadingTasks,
    error,

    // Editing state
    editingId: editingTaskId,
    editingTitle,
    setEditingTitle,

    // Actions
    loadTasks,
    loadTask,
    createConversation: createTask,
    selectConversation,
    setCurrentConversationId,
    deleteConversation,
    saveMessage,
    clearConversation,
    getConversationDetails,
    startNewChat,
    setError,

    // Editing actions
    startEditing,
    cancelEditing,
    finishEditing,
  };
}
