// src/types/index.ts
/**
 * Centralized type exports
 *
 * Import types from here for cleaner imports:
 * import type { Task, Agent, UIMessage } from '@/types';
 */

// Agent types (runtime)
export type {
  AgentDefinition,
  AgentLoopCallbacks,
  AgentLoopOptions,
  AgentLoopState,
  AgentRole,
  CompressionConfig,
  CompressionResult,
  CompressionSection,
  ConvertMessagesOptions,
  DynamicPromptConfig,
  ExecutionPhase,
  MessageAttachment,
  MessageCompactionOptions,
  ToolMessageContent,
  UIMessage,
} from './agent';
// API keys types
export type { ApiKeySettings, AvailableModel } from './api-keys';
// Command types
export type {
  Command,
  CommandCategory,
  CommandContext,
  CommandExecutor,
  CommandParameter,
  CommandResult,
  CommandSuggestion,
  CommandType,
  ParsedCommand,
} from './command';
// Custom provider types
export type {
  CustomProviderConfig,
  CustomProviderTestResult,
  CustomProviderType,
} from './custom-provider';
// Database Agent types
export type {
  Agent,
  CreateAgentData,
  DbAgent,
  UpdateAgentData,
} from './db-agent';
// File-based skill types
export type {
  FileBasedSkill,
  ParsedSkillMd,
  SkillMdFrontmatter,
  TalkCodySkillMetadata,
} from './file-based-skill';
// File system types
export type {
  FileNode,
  IndexingProgress,
  LoadingPhase,
  OpenFile,
  RepositoryState,
} from './file-system';
export type {
  BranchInfo,
  CommitInfo,
  DiffHunk,
  DiffLine,
  FileDiff,
  FileStatus,
  FileStatusMap,
  GitStatus,
  LineChange,
} from './git';
// Git types
export {
  DiffLineType,
  GitFileStatus,
} from './git';
// Marketplace skill types
export type {
  MarketplaceSkillMetadata,
  R2UploadResult,
  SkillInstallResult,
  SkillPackageManifest,
} from './marketplace-skill';
// MCP types
export type {
  CreateMCPServerData,
  MCPServer,
  MCPServerWithTools,
  MCPToolInfo,
  UpdateMCPServerData,
} from './mcp';
// Message storage types
export type {
  StoredAttachment,
  StoredMessage,
  StoredToolCall,
  StoredToolContent,
  StoredToolResult,
} from './message';
// Model types
export { ModelType } from './model-types';
export type { ModelConfig, ModelsConfiguration } from './models';
export type { NavigationItem } from './navigation';
// Navigation types
export { NavigationView } from './navigation';
// Prompt types
export type {
  PromptContextProvider,
  PromptTemplate,
  ResolveContext,
} from './prompt';
// Provider types
export type {
  ExtendedProviderDefinition,
  ProviderCreationContext,
  ProviderDefinition,
  ProviderRegistry,
  ProviderType,
} from './provider';
// Shortcuts types
export type {
  ModifierKeys,
  ShortcutAction,
  ShortcutConfig,
  ShortcutSettings,
} from './shortcuts';
export {
  DEFAULT_SHORTCUTS,
  formatShortcut,
  getShortcutSettingKey,
  MODIFIER_LABELS,
  parseShortcutString,
  shortcutMatches,
} from './shortcuts';
// Skill types
export type {
  ConversationSkill,
  CreateSkillRequest,
  DocumentationItem,
  DocumentationType,
  ListSkillsRequest,
  MarketplaceSkill,
  Skill,
  SkillCategory,
  SkillContent,
  SkillFilter,
  SkillLocalMetadata,
  SkillMarketplaceMetadata,
  SkillSortOption,
  SkillStats,
  SkillTag,
  SkillVersion,
  UpdateSkillRequest,
} from './skill';
// Skill permission types
export type { SkillScriptPermissionLevel } from './skill-permission';
// Task and Project types
export type {
  CreateProjectData,
  CreateTodoItem,
  Project,
  Task,
  TaskSettings,
  TodoItem,
  UpdateProjectData,
} from './task';
// Tool types
export type { ToolInput, ToolOutput, ToolWithUI } from './tool';
// User question types
export type {
  AskUserQuestionsInput,
  AskUserQuestionsOutput,
  Question,
  QuestionAnswer,
  QuestionOption,
} from './user-question';
