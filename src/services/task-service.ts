// src/services/task-service.ts
/**
 * TaskService - Unified entry point for task operations
 *
 * This service provides a single entry point for all task operations,
 * ensuring consistent state updates between TaskStore and database.
 *
 * Design principles:
 * - Synchronous store updates for immediate UI response
 * - Asynchronous database persistence
 * - All task operations go through this service
 */

import { logger } from '@/lib/logger';
import { mapStoredMessagesToUI } from '@/lib/message-mapper';
import { generateConversationTitle, generateId } from '@/lib/utils';
import { databaseService } from '@/services/database-service';
import { useExecutionStore } from '@/stores/execution-store';
import { settingsManager } from '@/stores/settings-store';
import { useTaskStore } from '@/stores/task-store';
import type { Task, TaskSettings } from '@/types';
import type { UIMessage } from '@/types/agent';

class TaskService {
  async createTask(
    userMessage: string,
    options?: {
      projectId?: string;
      onTaskStart?: (taskId: string, title: string) => void;
    }
  ): Promise<string> {
    const taskId = generateId();
    const title = generateConversationTitle(userMessage);
    const projectId = options?.projectId || (await settingsManager.getProject());

    const task: Task = {
      id: taskId,
      title,
      project_id: projectId,
      created_at: Date.now(),
      updated_at: Date.now(),
      message_count: 0,
      cost: 0,
      input_token: 0,
      output_token: 0,
    };

    // 1. Update store (synchronous)
    useTaskStore.getState().addTask(task);
    useTaskStore.getState().setCurrentTaskId(taskId);

    // 2. Persist to database
    try {
      await databaseService.createConversation(title, taskId, projectId);
      logger.info('[TaskService] Task created', { taskId, title });
    } catch (error) {
      logger.error('[TaskService] Failed to create task:', error);
      // Remove from store on error
      useTaskStore.getState().removeTask(taskId);
      throw error;
    }

    // 3. Notify callback
    options?.onTaskStart?.(taskId, title);

    return taskId;
  }

  /**
   * Load all tasks for a project
   */
  async loadTasks(projectId?: string): Promise<void> {
    const taskStore = useTaskStore.getState();
    taskStore.setLoadingTasks(true);
    taskStore.setError(null);

    try {
      const tasks = projectId
        ? await databaseService.getConversations(projectId)
        : await databaseService.getConversations();

      taskStore.setTasks(tasks);
      logger.info('[TaskService] Tasks loaded', { count: tasks.length });
    } catch (error) {
      logger.error('[TaskService] Failed to load tasks:', error);
      taskStore.setError('Failed to load tasks');
    } finally {
      taskStore.setLoadingTasks(false);
    }
  }

  /**
   * Load messages for a task
   */
  async loadMessages(taskId: string): Promise<UIMessage[]> {
    const taskStore = useTaskStore.getState();
    taskStore.setLoadingMessages(taskId, true);

    try {
      const storedMessages = await databaseService.getMessages(taskId);
      const messages = mapStoredMessagesToUI(storedMessages);

      taskStore.setMessages(taskId, messages);

      // LRU: touch cache and evict if needed
      taskStore.touchMessageCache(taskId);
      const runningTaskIds = useExecutionStore.getState().getRunningTaskIds();
      taskStore.evictOldestMessages(runningTaskIds);

      logger.info('[TaskService] Messages loaded', { taskId, count: messages.length });

      return messages;
    } catch (error) {
      logger.error('[TaskService] Failed to load messages:', error);
      taskStore.setError('Failed to load messages');
      return [];
    } finally {
      taskStore.setLoadingMessages(taskId, false);
    }
  }

  /**
   * Select a task (set as current and load messages if not cached)
   */
  async selectTask(taskId: string): Promise<void> {
    const taskStore = useTaskStore.getState();

    // Set as current task
    taskStore.setCurrentTaskId(taskId);
    settingsManager.setCurrentConversationId(taskId);

    // Touch cache for LRU tracking
    taskStore.touchMessageCache(taskId);

    // Load messages if not cached
    const existingMessages = taskStore.getMessages(taskId);
    if (existingMessages.length === 0) {
      await this.loadMessages(taskId);
    }

    // Update usage tracking from database
    try {
      const details = await databaseService.getConversationDetails(taskId);
      if (details) {
        taskStore.updateTask(taskId, {
          cost: details.cost,
          input_token: details.input_token,
          output_token: details.output_token,
        });
      }
    } catch (error) {
      logger.error('[TaskService] Failed to load task details:', error);
    }
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string): Promise<void> {
    // 1. Remove from store
    useTaskStore.getState().removeTask(taskId);

    // 2. Delete from database
    try {
      await databaseService.deleteConversation(taskId);
      logger.info('[TaskService] Task deleted', { taskId });
    } catch (error) {
      logger.error('[TaskService] Failed to delete task:', error);
      throw error;
    }
  }

  /**
   * Rename a task
   */
  async renameTask(taskId: string, title: string): Promise<void> {
    // 1. Update store
    useTaskStore.getState().updateTask(taskId, { title, updated_at: Date.now() });

    // 2. Persist to database
    try {
      await databaseService.updateConversationTitle(taskId, title);
      logger.info('[TaskService] Task renamed', { taskId, title });
    } catch (error) {
      logger.error('[TaskService] Failed to rename task:', error);
      throw error;
    }
  }

  /**
   * Update task settings
   */
  async updateTaskSettings(taskId: string, settings: TaskSettings): Promise<void> {
    // 1. Update store
    useTaskStore.getState().updateTaskSettings(taskId, settings);

    // 2. Persist to database
    try {
      await databaseService.updateConversationSettings(taskId, JSON.stringify(settings));
      logger.info('[TaskService] Task settings updated', { taskId, settings });
    } catch (error) {
      logger.error('[TaskService] Failed to update task settings:', error);
      throw error;
    }
  }

  /**
   * Update task usage (cost, tokens)
   */
  async updateTaskUsage(
    taskId: string,
    cost: number,
    inputTokens: number,
    outputTokens: number
  ): Promise<void> {
    // 1. Update store (accumulate)
    useTaskStore.getState().updateTaskUsage(taskId, cost, inputTokens, outputTokens);

    // 2. Persist to database
    try {
      await databaseService.updateConversationUsage(taskId, cost, inputTokens, outputTokens);
      logger.info('[TaskService] Task usage updated', { taskId, cost, inputTokens, outputTokens });
    } catch (error) {
      logger.error('[TaskService] Failed to update task usage:', error);
    }
  }

  /**
   * Get task details
   */
  async getTaskDetails(taskId: string): Promise<Task | null> {
    // Try store first
    const cachedTask = useTaskStore.getState().getTask(taskId);
    if (cachedTask) {
      return cachedTask;
    }

    // Fetch from database
    try {
      const task = await databaseService.getConversationDetails(taskId);
      if (!task) return null;

      // Update store cache
      useTaskStore.getState().addTask(task);

      return task;
    } catch (error) {
      logger.error('[TaskService] Failed to get task details:', error);
      return null;
    }
  }

  /**
   * Start a new chat (clear current task)
   */
  startNewChat(): void {
    useTaskStore.getState().setCurrentTaskId(null);
    // Note: settingsManager.setCurrentConversationId requires a string,
    // but clearing it requires passing empty string to indicate no selection
    settingsManager.setCurrentConversationId('');
  }
}

export const taskService = new TaskService();
