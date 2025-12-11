// src/services/database/types.ts
import type { MessageAttachment } from '@/types/agent';

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

export interface StoredMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  assistant_id?: string;
  position_index: number;
  attachments?: MessageAttachment[];
}

/**
 * Stored format for tool messages (serialized as JSON in content field)
 * Supports both tool-call and tool-result types
 */
export type StoredToolContent = StoredToolCall | StoredToolResult;

export interface StoredToolCall {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
}

export interface StoredToolResult {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
  output?: unknown; // Full output for proper restoration
  inputSummary?: string; // Deprecated: kept for backward compatibility
  status: 'success' | 'error';
  errorMessage?: string;
}

export interface StoredAttachment {
  id: string;
  message_id: string;
  type: 'image' | 'text' | 'code' | 'markdown' | 'pdf' | 'other';
  filename: string;
  file_path: string;
  mime_type: string;
  size: number;
  created_at: number;
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

export interface Agent {
  id: string;
  name: string;
  description: string;
  model_type: string; // Model type category (main_model, small_model, etc.)
  system_prompt: string;
  tools_config: string; // JSON string
  rules: string;
  output_format: string;
  is_hidden: boolean;
  is_default: boolean;
  is_enabled: boolean;
  dynamic_enabled?: boolean;
  dynamic_providers?: string; // JSON array
  dynamic_variables?: string; // JSON object
  dynamic_provider_settings?: string; // JSON object

  // Skills configuration
  default_skills?: string; // JSON array of skill IDs

  // Marketplace fields
  source_type: 'system' | 'local' | 'marketplace';
  marketplace_id?: string;
  marketplace_version?: string;
  forked_from_id?: string;
  forked_from_marketplace_id?: string;
  is_shared: boolean;
  last_synced_at?: number;
  icon_url?: string;
  author_name?: string;
  author_id?: string;
  categories: string; // JSON array
  tags: string; // JSON array

  created_at: number;
  updated_at: number;
  created_by: string;
  usage_count: number;
}

export interface CreateAgentData {
  id: string;
  name: string;
  description?: string;
  model_type: string; // Model type category
  system_prompt: string;
  tools_config?: string;
  rules?: string;
  output_format?: string;
  is_hidden?: boolean;
  is_default?: boolean;
  is_enabled?: boolean;
  created_by?: string;
  dynamic_enabled?: boolean;
  dynamic_providers?: string; // JSON array
  dynamic_variables?: string; // JSON object
  dynamic_provider_settings?: string; // JSON object

  // Skills configuration
  default_skills?: string; // JSON array of skill IDs

  // Marketplace fields
  source_type?: 'system' | 'local' | 'marketplace';
  marketplace_id?: string;
  marketplace_version?: string;
  forked_from_id?: string;
  forked_from_marketplace_id?: string;
  is_shared?: boolean;
  icon_url?: string;
  author_name?: string;
  author_id?: string;
  categories?: string; // JSON array
  tags?: string; // JSON array
}

export interface UpdateAgentData {
  name?: string;
  description?: string;
  model?: string; // DEPRECATED: kept for backwards compatibility
  model_type?: string; // Model type category
  system_prompt?: string;
  tools_config?: string;
  rules?: string;
  output_format?: string;
  is_hidden?: boolean;
  is_default?: boolean;
  is_enabled?: boolean;
  dynamic_enabled?: boolean;
  dynamic_providers?: string; // JSON array
  dynamic_variables?: string; // JSON object
  dynamic_provider_settings?: string; // JSON object

  // Skills configuration
  default_skills?: string; // JSON array of skill IDs

  // Marketplace fields
  source_type?: 'system' | 'local' | 'marketplace';
  marketplace_id?: string;
  marketplace_version?: string;
  is_shared?: boolean;
  last_synced_at?: number;
  icon_url?: string;
  categories?: string; // JSON array
  tags?: string; // JSON array
}

export interface MCPServer {
  id: string;
  name: string;
  url: string;
  protocol: 'http' | 'sse' | 'stdio';
  api_key?: string;
  headers?: Record<string, string>;
  stdio_command?: string;
  stdio_args?: string[];
  stdio_env?: Record<string, string>;
  is_enabled: boolean;
  is_built_in: boolean;
  created_at: number;
  updated_at: number;
}

export interface CreateMCPServerData {
  id: string;
  name: string;
  url: string;
  protocol: 'http' | 'sse' | 'stdio';
  api_key?: string;
  headers?: Record<string, string>;
  stdio_command?: string;
  stdio_args?: string[];
  stdio_env?: Record<string, string>;
  is_enabled?: boolean;
  is_built_in?: boolean;
}

export interface UpdateMCPServerData {
  name?: string;
  url?: string;
  protocol?: 'http' | 'sse' | 'stdio';
  api_key?: string;
  headers?: Record<string, string>;
  stdio_command?: string;
  stdio_args?: string[];
  stdio_env?: Record<string, string>;
  is_enabled?: boolean;
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
