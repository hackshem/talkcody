// src/types/task.ts
/**
 * Task and Project type definitions
 */

export interface Project {
  id: string;
  name: string;
  description: string;
  created_at: number;
  updated_at: number;
  context: string;
  rules: string;
  root_path?: string;
}

export interface Task {
  id: string;
  title: string;
  project_id: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  cost: number;
  input_token: number;
  output_token: number;
  settings?: string; // JSON string for conversation-level settings
  context_usage?: number; // Percentage of context window used
}

export interface TaskSettings {
  autoApproveEdits?: boolean; // When true, skip review dialog for file edits in this conversation
}

export interface CreateProjectData {
  name: string;
  description?: string;
  context?: string;
  rules?: string;
  root_path?: string;
}

export interface UpdateProjectData {
  name?: string;
  description?: string;
  context?: string;
  rules?: string;
  root_path?: string;
}

export interface TodoItem {
  id: string;
  conversation_id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  created_at: number;
  updated_at: number;
}

export interface CreateTodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}
