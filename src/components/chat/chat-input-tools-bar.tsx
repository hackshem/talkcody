// src/components/chat/chat-input-tools-bar.tsx

import { CurrentFileButton } from './current-file-button';
import { McpSelectorButton } from './mcp-selector-button';
import { ModelSelectorButton } from './model-selector-button';
import { SkillsSelectorButton } from './skills-selector-button';
import { ToolSelectorButton } from './tool-selector-button';

interface ChatInputToolsBarProps {
  conversationId?: string | null;
  disabled?: boolean;
  onAddCurrentFile?: () => void;
}

export function ChatInputToolsBar({
  conversationId,
  disabled,
  onAddCurrentFile,
}: ChatInputToolsBarProps) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 border-b border-border/50">
      <ToolSelectorButton />
      <SkillsSelectorButton conversationId={conversationId} />
      <McpSelectorButton />
      <ModelSelectorButton />
      {onAddCurrentFile && <CurrentFileButton disabled={disabled} onAddFile={onAddCurrentFile} />}
    </div>
  );
}
