import { Maximize2, Minimize2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { logger } from '@/lib/logger';
import { terminalService } from '@/services/terminal-service';
import { useTerminalStore } from '@/stores/terminal-store';
import { useRepositoryStore } from '@/stores/window-scoped-repository-store';
import { Terminal } from './terminal';
import { TerminalTabs } from './terminal-tabs';

interface TerminalPanelProps {
  onCopyToChat?: (content: string) => void;
  onClose?: () => void;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
}

export function TerminalPanel({ onClose, onToggleFullscreen, isFullscreen }: TerminalPanelProps) {
  const activeSessionId = useTerminalStore((state) => state.activeSessionId);
  const sessions = useTerminalStore((state) => state.sessions);
  const autoCreateAllowed = useTerminalStore((state) => state.autoCreateAllowed);
  const rootPath = useRepositoryStore((state) => state.rootPath);
  const isCreatingTerminal = useRef(false);

  // // Get active session from the Map
  // const activeSession = activeSessionId ? sessions.get(activeSessionId) : undefined;

  // Note: Terminal service is now initialized in initialization-manager.ts
  // Cleanup is handled when the app closes, not when this component unmounts

  useEffect(() => {
    // Create initial terminal if none exist
    if (sessions.size === 0 && autoCreateAllowed && !isCreatingTerminal.current) {
      logger.info('Creating initial terminal', {
        sessionsSize: sessions.size,
        rootPath,
        autoCreateAllowed,
        isCreating: isCreatingTerminal.current,
      });
      isCreatingTerminal.current = true;
      terminalService
        .createTerminal(rootPath || undefined)
        .catch((error) => {
          logger.error('Failed to create initial terminal', error);
        })
        .finally(() => {
          isCreatingTerminal.current = false;
        });
    }
  }, [sessions.size, rootPath, autoCreateAllowed]);

  // const handleCopyToChat = () => {
  //   if (!activeSessionId) {
  //     return;
  //   }

  //   const recentOutput = terminalService.getRecentCommands(activeSessionId, 50);

  //   if (!recentOutput.trim()) {
  //     toast.error('No terminal output to copy');
  //     return;
  //   }

  //   // Format as markdown code block
  //   const formattedContent = `\`\`\`terminal\n${recentOutput}\n\`\`\``;

  //   if (onCopyToChat) {
  //     onCopyToChat(formattedContent);
  //     toast.success('Terminal output copied to chat');
  //   } else {
  //     // Fallback: copy to clipboard
  //     navigator.clipboard.writeText(formattedContent).then(() => {
  //       toast.success('Terminal output copied to clipboard');
  //     });
  //   }
  // };

  return (
    <div className="flex flex-col h-full bg-background pb-1">
      {/* Combined Toolbar and Tabs */}
      <div className="flex items-center justify-between h-9 px-2 border-b bg-muted/20">
        <TerminalTabs />
        <div className="flex items-center gap-1">
          {onToggleFullscreen && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
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
          {onClose && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Close terminal</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Terminal content */}
      <div className="flex-1 overflow-hidden">
        {activeSessionId ? (
          <Terminal sessionId={activeSessionId} />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            No terminal sessions
          </div>
        )}
      </div>
    </div>
  );
}
