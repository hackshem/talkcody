import { ArrowDown, ArrowUp, Maximize2, Minimize2, Plus, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/hooks/use-locale';
import {
  formatCost,
  formatTokens,
  getContextUsageBgColor,
  getContextUsageColor,
  useToolbarState,
} from '@/hooks/use-toolbar-state';
import { useExecutionStore } from '@/stores/execution-store';
import { usePlanModeStore } from '@/stores/plan-mode-store';
import { ChatHistory } from './chat-history';

interface ChatPanelHeaderProps {
  currentConversationId?: string;
  isHistoryOpen: boolean;
  onHistoryOpenChange: (open: boolean) => void;
  onConversationSelect: (conversationId: string) => void;
  onNewChat: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export function ChatPanelHeader({
  currentConversationId,
  isHistoryOpen,
  onHistoryOpenChange,
  onConversationSelect,
  onNewChat,
  isFullscreen,
  onToggleFullscreen,
}: ChatPanelHeaderProps) {
  const t = useTranslation();
  const isMaxReached = useExecutionStore((state) => state.isMaxReached());
  const { modelName, cost, inputTokens, outputTokens, contextUsage } = useToolbarState();

  return (
    <div className="flex h-[42px] flex-shrink-0 items-center justify-between border-b bg-gray-50 px-3 dark:bg-gray-900">
      {/* Left: Model, Plan Mode, Cost/Tokens */}
      <div className="flex items-center gap-3">
        {modelName && (
          <div className="flex items-center gap-1.5 rounded-md bg-blue-100 px-2 py-1 dark:bg-blue-900/30">
            <span className="font-medium text-blue-700 text-xs dark:text-blue-300">
              {t.Chat.toolbar.model}:
            </span>
            <span className="font-medium text-blue-900 text-xs dark:text-blue-100">
              {modelName}
            </span>
          </div>
        )}

        {(cost > 0 || inputTokens > 0 || outputTokens > 0) && (
          <div className="flex items-center gap-1.5 rounded-md bg-emerald-100 px-2 py-1 dark:bg-emerald-900/30">
            <span className="font-medium text-emerald-700 text-xs dark:text-emerald-300">
              {formatCost(cost)}
            </span>
            <span className="flex items-center text-emerald-600 text-xs dark:text-emerald-400">
              <ArrowUp className="h-3 w-3" />
              {formatTokens(inputTokens)} {t.Chat.toolbar.inputTokens}
            </span>
            <span className="flex items-center text-emerald-600 text-xs dark:text-emerald-400">
              <ArrowDown className="h-3 w-3" />
              {formatTokens(outputTokens)} {t.Chat.toolbar.outputTokens}
            </span>
          </div>
        )}

        {contextUsage > 0 && (
          <div
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 ${getContextUsageBgColor(contextUsage)}`}
          >
            <span className={`font-medium text-xs ${getContextUsageColor(contextUsage)}`}>
              Context: {contextUsage.toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="h-6 w-6 p-0 hover:bg-gray-200 dark:hover:bg-gray-700"
              disabled={isMaxReached}
              onClick={onNewChat}
              size="sm"
              title={isMaxReached ? 'Maximum concurrent tasks reached' : undefined}
              variant="ghost"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t.Chat.newChat}</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <ChatHistory
                currentConversationId={currentConversationId}
                isOpen={isHistoryOpen}
                onConversationSelect={onConversationSelect}
                onNewChat={onNewChat}
                onOpenChange={onHistoryOpenChange}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t.Chat.chatHistory}</p>
          </TooltipContent>
        </Tooltip>

        {/* Fullscreen Toggle */}
        {onToggleFullscreen && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 p-0 hover:bg-gray-200 dark:hover:bg-gray-700"
                onClick={onToggleFullscreen}
              >
                {isFullscreen ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
