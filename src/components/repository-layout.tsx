import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ResizablePanelGroup } from '@/components/ui/resizable';
import { useGlobalFileSearch } from '@/hooks/use-global-file-search';
import { useGlobalShortcuts } from '@/hooks/use-global-shortcuts';
import { useTranslation } from '@/hooks/use-locale';
import { useRepositoryWatcher } from '@/hooks/use-repository-watcher';
import { useStableRunningIds } from '@/hooks/use-stable-running-ids';
import { useTask } from '@/hooks/use-task';
import { useTasks } from '@/hooks/use-tasks';
import { useWorktreeConflict } from '@/hooks/use-worktree-conflict';
import { logger } from '@/lib/logger';
import { databaseService } from '@/services/database-service';
import type { LintDiagnostic } from '@/services/lint-service';
import { getRelativePath } from '@/services/repository-utils';
import { terminalService } from '@/services/terminal-service';
import { WindowManagerService } from '@/services/window-manager-service';
import { useExecutionStore } from '@/stores/execution-store';
import { useGitStore } from '@/stores/git-store';
import { useLintStore } from '@/stores/lint-store';
import { useProjectStore } from '@/stores/project-store';
import { DEFAULT_PROJECT, settingsManager, useSettingsStore } from '@/stores/settings-store';
import { useTerminalStore } from '@/stores/terminal-store';
import { useRepositoryStore } from '@/stores/window-scoped-repository-store';
import { useWorktreeStore } from '@/stores/worktree-store';
import { SidebarView } from '@/types/navigation';
import type { ChatBoxRef } from './chat-box';
import { GitStatusBar } from './git/git-status-bar';
import { RepositoryChatPanel } from './repository-layout/repository-chat-panel';
import { RepositoryDialogs } from './repository-layout/repository-dialogs';
import { RepositoryEditorArea } from './repository-layout/repository-editor-area';
import { RepositoryGlobalSearch } from './repository-layout/repository-global-search';
import { RepositorySidebar } from './repository-layout/repository-sidebar';
import type { FullscreenPanel } from './repository-layout/types';

export function RepositoryLayout() {
  const t = useTranslation();
  const [sidebarView, setSidebarView] = useState<SidebarView>(SidebarView.FILES);
  const [taskSearchQuery, setTaskSearchQuery] = useState('');

  const emptyRepoPanelId = useId();
  const fileTreePanelId = useId();
  const fileEditorPanelId = useId();
  const mainChatPanelId = useId();
  const terminalPanelId = useId();
  const editorAreaPanelId = useId();

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isContentSearchVisible, setIsContentSearchVisible] = useState(false);
  const contentSearchInputRef = useRef<HTMLInputElement>(null);

  // Get current project ID from settings store (reactive to changes)
  const currentProjectId = useSettingsStore((state) => state.project);
  const isDefaultProject = currentProjectId === DEFAULT_PROJECT;

  // Circuit breaker: track paths that failed to open to prevent infinite retry loops
  const [failedPaths] = useState(() => new Set<string>());

  // Fullscreen panel state
  const [fullscreenPanel, setFullscreenPanel] = useState<FullscreenPanel>('none');

  const toggleFullscreen = (panel: 'editor' | 'terminal' | 'chat') => {
    setFullscreenPanel((prev) => (prev === panel ? 'none' : panel));
  };

  // Terminal state
  const isTerminalVisible = useTerminalStore((state) => state.isTerminalVisible);
  const toggleTerminalVisible = useTerminalStore((state) => state.toggleTerminalVisible);
  const selectNextSession = useTerminalStore((state) => state.selectNextSession);
  const selectPreviousSession = useTerminalStore((state) => state.selectPreviousSession);

  // Use zustand store for repository state
  const rootPath = useRepositoryStore((state) => state.rootPath);
  const fileTree = useRepositoryStore((state) => state.fileTree);
  const openFiles = useRepositoryStore((state) => state.openFiles);
  const activeFileIndex = useRepositoryStore((state) => state.activeFileIndex);
  const isLoading = useRepositoryStore((state) => state.isLoading);
  const expandedPaths = useRepositoryStore((state) => state.expandedPaths);
  const searchFiles = useRepositoryStore((state) => state.searchFiles);
  const selectRepository = useRepositoryStore((state) => state.selectRepository);
  const openRepository = useRepositoryStore((state) => state.openRepository);
  const selectFile = useRepositoryStore((state) => state.selectFile);
  const switchToTab = useRepositoryStore((state) => state.switchToTab);
  const closeTab = useRepositoryStore((state) => state.closeTab);
  const closeOthers = useRepositoryStore((state) => state.closeOthers);
  const updateFileContent = useRepositoryStore((state) => state.updateFileContent);
  const closeRepository = useRepositoryStore((state) => state.closeRepository);
  const refreshFile = useRepositoryStore((state) => state.refreshFile);
  const refreshFileTree = useRepositoryStore((state) => state.refreshFileTree);
  const loadDirectoryChildren = useRepositoryStore((state) => state.loadDirectoryChildren);
  const closeAllFiles = useRepositoryStore((state) => state.closeAllFiles);
  const createFile = useRepositoryStore((state) => state.createFile);
  const renameFile = useRepositoryStore((state) => state.renameFile);
  const toggleExpansion = useRepositoryStore((state) => state.toggleExpansion);
  const getRecentFiles = useRepositoryStore((state) => state.getRecentFiles);

  // Derive currentFile from openFiles and activeFileIndex
  const currentFile =
    activeFileIndex >= 0 && activeFileIndex < openFiles.length ? openFiles[activeFileIndex] : null;

  // Set up file system watcher
  useRepositoryWatcher();

  // Git store actions
  const initializeGit = useGitStore((state) => state.initialize);
  const refreshGitStatus = useGitStore((state) => state.refreshStatus);
  const clearGitState = useGitStore((state) => state.clearState);

  // Project store actions
  const refreshProjects = useProjectStore((state) => state.refreshProjects);

  // Worktree store actions
  const initializeWorktree = useWorktreeStore((state) => state.initialize);

  const chatBoxRef = useRef<ChatBoxRef | null>(null);

  // Determine if we have a loaded repository
  const hasRepository = !!(rootPath && fileTree);

  // Determine if we should show sidebar (show when has repository OR default project selected)
  const shouldShowSidebar = hasRepository || isDefaultProject;

  const handleAddFileToChat = async (filePath: string, fileContent: string) => {
    // This will be handled by ChatBox's internal handleExternalAddFileToChat
    // which will delegate to ChatInput's addFileToChat method
    if (chatBoxRef.current?.addFileToChat) {
      await chatBoxRef.current.addFileToChat(filePath, fileContent);
    }
  };

  const {
    tasks,
    loading: tasksLoading,
    editingId,
    editingTitle,
    setEditingTitle,
    deleteTask,
    finishEditing,
    startEditing,
    cancelEditing,
    selectTask,
    currentTaskId,
    startNewChat,
    loadTasks,
  } = useTasks();

  // Get current task and messages for sharing
  const { task: currentTask, messages: currentMessages } = useTask(currentTaskId);

  // Task History state
  const runningTaskIds = useStableRunningIds();
  const isMaxReached = useExecutionStore((state) => state.isMaxReached());
  const getWorktreeForTask = useWorktreeStore((state) => state.getWorktreeForTask);

  // Worktree deletion confirmation state
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    taskId: string;
    changesCount: number;
    message: string;
  } | null>(null);

  const normalizedTaskSearch = taskSearchQuery.trim().toLowerCase();

  // Filter tasks based on search query and current project
  const filteredTasks = useMemo(() => {
    const hasSearch = normalizedTaskSearch.length > 0;
    const hasProject = Boolean(currentProjectId);

    if (!hasSearch && !hasProject) {
      return tasks;
    }

    return tasks.filter((task) => {
      const matchesSearch = !hasSearch || task.title.toLowerCase().includes(normalizedTaskSearch);
      const matchesProject = !hasProject || task.project_id === currentProjectId;
      return matchesSearch && matchesProject;
    });
  }, [tasks, normalizedTaskSearch, currentProjectId]);

  // Worktree conflict handling
  const {
    conflictData,
    isProcessing: isWorktreeProcessing,
    mergeResult,
    syncResult,
    checkForConflicts,
    discardChanges,
    mergeToMain,
    syncFromMain,
    cancelOperation,
    resetState: resetWorktreeState,
  } = useWorktreeConflict();

  const {
    isOpen: isFileSearchOpen,
    openSearch: openFileSearch,
    closeSearch: closeFileSearch,
    handleFileSelect: handleSearchFileSelect,
  } = useGlobalFileSearch(selectFile);

  // Setup global shortcuts
  useGlobalShortcuts({
    globalFileSearch: () => {
      openFileSearch();
    },
    globalContentSearch: () => {
      setIsContentSearchVisible((prev) => !prev);
    },
    saveFile: () => {
      // TODO: Implement save functionality
      logger.debug('Save file shortcut triggered');
    },
    fileSearch: () => {
      // TODO: Implement file search in editor
      logger.debug('File search shortcut triggered');
    },
    toggleTerminal: () => {
      toggleTerminalVisible();
    },
    nextTerminalTab: () => {
      if (isTerminalVisible) {
        selectNextSession();
      }
    },
    previousTerminalTab: () => {
      if (isTerminalVisible) {
        selectPreviousSession();
      }
    },
    newTerminalTab: async () => {
      if (isTerminalVisible) {
        await terminalService.createTerminal(rootPath || undefined);
      }
    },
  });

  useEffect(() => {
    if (isContentSearchVisible) {
      setTimeout(() => contentSearchInputRef.current?.focus(), 100);
    }
  }, [isContentSearchVisible]);

  useEffect(() => {
    if (sidebarView === SidebarView.TASKS) {
      loadTasks(currentProjectId || undefined);
    }
  }, [sidebarView, currentProjectId, loadTasks]);

  // Force switch to Tasks view when no repository but default project selected
  useEffect(() => {
    if (!hasRepository && isDefaultProject && sidebarView === SidebarView.FILES) {
      setSidebarView(SidebarView.TASKS);
    }
  }, [hasRepository, isDefaultProject, sidebarView]);

  // Load saved repository on component mount
  useEffect(() => {
    let isMounted = true;

    const loadSavedRepository = async () => {
      // Only execute if app.tsx hasn't loaded a project yet
      if (!isMounted || rootPath) return;

      // Check if this is a new window
      const isNewWindow = await WindowManagerService.checkNewWindowFlag();
      if (isNewWindow) {
        logger.info('[repository-layout] New window detected - skipping auto-load');
        await WindowManagerService.clearNewWindowFlag();
        return;
      }

      // Check if window has associated project
      const windowInfo = await WindowManagerService.getWindowInfo();
      if (windowInfo?.rootPath) {
        logger.info('[repository-layout] Window has associated project, skip global load');
        return;
      }

      // Load global saved project
      const savedPath = settingsManager.getCurrentRootPath();
      const projectId = await settingsManager.getProject();

      if (!savedPath || failedPaths.has(savedPath)) {
        return;
      }

      try {
        await openRepository(savedPath, projectId);
        logger.info('[repository-layout] Restored saved repository:', savedPath);
      } catch (error) {
        logger.error('[repository-layout] Failed to restore saved repository:', error);
        failedPaths.add(savedPath);
        settingsManager.setCurrentRootPath('');
      }
    };

    loadSavedRepository();

    return () => {
      isMounted = false;
    };
  }, [openRepository, rootPath, failedPaths]);

  // Initialize Git when repository changes
  useEffect(() => {
    if (rootPath) {
      initializeGit(rootPath);
    } else {
      clearGitState();
    }
  }, [rootPath, initializeGit, clearGitState]);

  const handleNewChat = async () => {
    const hasConflict = await checkForConflicts();
    if (hasConflict) {
      return;
    }
    startNewChat();
    // If we're in tasks view, we don't need to close anything
    // If we were in history sidebar (old design), we would close it
  };

  // Handle task deletion with worktree confirmation
  const handleDeleteTask = async (taskId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const result = await deleteTask(taskId);
    if (result.requiresConfirmation && result.changesCount && result.message) {
      setDeleteConfirmation({
        taskId,
        changesCount: result.changesCount,
        message: result.message,
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (deleteConfirmation) {
      await deleteTask(deleteConfirmation.taskId, { force: true });
      setDeleteConfirmation(null);
    }
  };

  const handleCancelDelete = () => {
    setDeleteConfirmation(null);
  };

  // Handle discard and continue with new chat
  const handleDiscardAndContinue = async () => {
    await discardChanges();
    resetWorktreeState();
    startNewChat();
    setIsHistoryOpen(false);
  };

  // Handle merge and continue with new chat
  const handleMergeAndContinue = async () => {
    const result = await mergeToMain();
    if (result.success) {
      resetWorktreeState();
      startNewChat();
      setIsHistoryOpen(false);
    }
    // If there are conflicts, the dialog will show them
  };

  // Handle sync from main (user wants to keep working with latest main changes)
  const handleSyncFromMain = async () => {
    const result = await syncFromMain();
    if (result.success) {
      // Sync successful - dialog will close, user can continue working
      resetWorktreeState();
    }
    // If there are conflicts, the dialog will show them
  };

  const handleHistoryTaskSelect = (taskId: string) => {
    selectTask(taskId);
    // No need to close history sidebar anymore as it's part of the main layout
  };

  const handleTaskStart = (taskId: string, _title: string) => {
    selectTask(taskId);
  };

  const handleDiffApplied = () => {
    refreshFileTree();
    if (currentFile) {
      refreshFile(currentFile.path);
    }
    // Refresh Git status when files change
    refreshGitStatus();
  };

  const handleProjectSelect = async (projectId: string) => {
    try {
      // Get the project from database
      const project = await databaseService.getProject(projectId);
      if (project) {
        // Save project ID to settings (will trigger reactive update)
        await settingsManager.setProject(projectId);

        // If project has root_path, open the repository
        if (project.root_path) {
          await openRepository(project.root_path, projectId);

          // Initialize worktree store for this project
          initializeWorktree().catch((error) => {
            logger.warn('[RepositoryLayout] Failed to initialize worktree store:', error);
          });
        } else {
          // If project has no root_path, close current repository to clear the UI
          closeRepository();
        }
      }
    } catch (error) {
      logger.error('Failed to switch project:', error);
      throw error;
    }
  };

  const handleFileDelete = async (filePath: string) => {
    refreshFileTree();
    // Close the tab if the deleted file is open
    const fileIndex = openFiles.findIndex((file) => file.path === filePath);
    if (fileIndex !== -1) {
      closeTab(fileIndex);
    }
    // Refresh Git status
    refreshGitStatus();
  };

  const handleFileCreate = async (parentPath: string, fileName: string, isDirectory: boolean) => {
    try {
      await createFile(parentPath, fileName, isDirectory);
      // Refresh Git status
      refreshGitStatus();
    } catch (error) {
      logger.error('Failed to create file/directory:', error);
      // The toast error will be shown by the service
    }
  };

  const handleFileRename = async (oldPath: string, newName: string) => {
    try {
      await renameFile(oldPath, newName);
      // Refresh Git status
      refreshGitStatus();
    } catch (error) {
      logger.error('Failed to rename file/directory:', error);
      // The toast error will be shown by the service
    }
  };

  const handleCopyPath = (filePath: string) => {
    navigator.clipboard.writeText(filePath);
    toast.success(t.FileTree.success.pathCopied);
  };

  const handleCopyRelativePath = (filePath: string, rootPath: string) => {
    const relativePath = getRelativePath(filePath, rootPath);
    navigator.clipboard.writeText(relativePath);
    toast.success(t.FileTree.success.relativePathCopied);
  };

  // Get the currently selected file path for the file tree
  const selectedFilePath = currentFile?.path || null;

  const hasOpenFiles = openFiles.length > 0;

  // Lint diagnostics state
  const { settings } = useLintStore();
  const showDiagnostics = settings.enabled && settings.showInProblemsPanel;

  // Fullscreen panel display logic
  const showFileTree = fullscreenPanel === 'none';
  const showMiddlePanel =
    fullscreenPanel === 'none' || fullscreenPanel === 'editor' || fullscreenPanel === 'terminal';
  const showChatPanel = fullscreenPanel === 'none' || fullscreenPanel === 'chat';
  const showEditor = fullscreenPanel !== 'terminal' && fullscreenPanel !== 'chat';
  const showTerminal =
    isTerminalVisible && fullscreenPanel !== 'editor' && fullscreenPanel !== 'chat';
  const showProblemsPanel = showDiagnostics && hasOpenFiles && fullscreenPanel === 'none';
  const isEditorFullscreen = fullscreenPanel === 'editor';
  const isTerminalFullscreen = fullscreenPanel === 'terminal';
  const isChatFullscreen = fullscreenPanel === 'chat';

  // Handle diagnostic click
  const handleDiagnosticClick = (diagnostic: LintDiagnostic & { filePath: string }) => {
    selectFile(diagnostic.filePath, diagnostic.range.start.line);
  };

  return (
    <>
      <RepositoryGlobalSearch
        getRecentFiles={getRecentFiles}
        isFileSearchOpen={isFileSearchOpen}
        onCloseFileSearch={closeFileSearch}
        onFileSelect={handleSearchFileSelect}
        onSearchFiles={searchFiles}
        repositoryPath={rootPath}
        isContentSearchVisible={isContentSearchVisible}
        onToggleContentSearch={() => setIsContentSearchVisible((prev) => !prev)}
        contentSearchInputRef={contentSearchInputRef}
        showContentSearch={hasRepository}
      />

      <div className="flex h-screen flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <ResizablePanelGroup className="h-full" direction="horizontal">
            {showFileTree && (
              <RepositorySidebar
                emptyRepoPanelId={emptyRepoPanelId}
                fileTreePanelId={fileTreePanelId}
                shouldShowSidebar={shouldShowSidebar}
                hasRepository={hasRepository}
                sidebarView={sidebarView}
                onSidebarViewChange={(view) => {
                  setSidebarView(view);
                  settingsManager.setSidebarView(view);
                }}
                currentProjectId={currentProjectId}
                onProjectSelect={handleProjectSelect}
                onImportRepository={async () => {
                  const newProject = await selectRepository();
                  if (newProject) {
                    await refreshProjects();
                  }
                }}
                onSelectRepository={async () => {
                  const newProject = await selectRepository();
                  if (newProject) {
                    await refreshProjects();
                  }
                }}
                onOpenRepository={async (path, projectId) => {
                  await openRepository(path, projectId);
                  await refreshProjects();
                }}
                isLoadingProject={isLoading}
                isTerminalVisible={hasRepository ? isTerminalVisible : undefined}
                onToggleTerminal={hasRepository ? toggleTerminalVisible : undefined}
                onOpenFileSearch={hasRepository ? openFileSearch : undefined}
                onOpenContentSearch={
                  hasRepository ? () => setIsContentSearchVisible(true) : undefined
                }
                rootPath={rootPath}
                fileTree={fileTree}
                expandedPaths={expandedPaths}
                selectedFilePath={selectedFilePath}
                onFileCreate={handleFileCreate}
                onFileDelete={handleFileDelete}
                onFileRename={handleFileRename}
                onFileSelect={selectFile}
                onRefreshFileTree={refreshFileTree}
                onLoadChildren={loadDirectoryChildren}
                onToggleExpansion={toggleExpansion}
                taskSearchQuery={taskSearchQuery}
                onTaskSearchQueryChange={setTaskSearchQuery}
                isMaxReached={isMaxReached}
                onNewChat={handleNewChat}
                filteredTasks={filteredTasks}
                tasksLoading={tasksLoading}
                currentTaskId={currentTaskId}
                editingId={editingId}
                editingTitle={editingTitle}
                onCancelEdit={cancelEditing}
                onTaskSelect={handleHistoryTaskSelect}
                onDeleteTask={handleDeleteTask}
                onSaveEdit={finishEditing}
                onStartEditing={startEditing}
                onTitleChange={setEditingTitle}
                runningTaskIds={runningTaskIds}
                getWorktreeForTask={getWorktreeForTask}
              />
            )}

            {hasRepository && showMiddlePanel && (hasOpenFiles || isTerminalVisible) && (
              <RepositoryEditorArea
                editorAreaPanelId={editorAreaPanelId}
                fileEditorPanelId={fileEditorPanelId}
                terminalPanelId={terminalPanelId}
                showChatPanel={showChatPanel}
                showEditor={showEditor}
                showTerminal={showTerminal}
                showProblemsPanel={showProblemsPanel}
                hasOpenFiles={hasOpenFiles}
                isEditorFullscreen={isEditorFullscreen}
                isTerminalFullscreen={isTerminalFullscreen}
                openFiles={openFiles}
                activeFileIndex={activeFileIndex}
                currentFile={currentFile}
                rootPath={rootPath}
                onTabClose={closeTab}
                onCloseOthers={closeOthers}
                onCloseAll={closeAllFiles}
                onCopyPath={handleCopyPath}
                onCopyRelativePath={handleCopyRelativePath}
                onAddFileToChat={handleAddFileToChat}
                onTabSelect={switchToTab}
                onContentChange={(content) => {
                  if (currentFile) {
                    updateFileContent(currentFile.path, content, true);
                  }
                }}
                onToggleContentSearch={() => setIsContentSearchVisible((prev) => !prev)}
                onToggleEditorFullscreen={() => toggleFullscreen('editor')}
                onDiagnosticClick={handleDiagnosticClick}
                onCopyTerminalToChat={(content) => {
                  if (chatBoxRef.current?.appendToInput) {
                    chatBoxRef.current.appendToInput(`\n\n${content}`);
                  }
                }}
                onCloseTerminal={toggleTerminalVisible}
                onToggleTerminalFullscreen={() => toggleFullscreen('terminal')}
              />
            )}

            {showChatPanel && (
              <RepositoryChatPanel
                mainChatPanelId={mainChatPanelId}
                hasRepository={hasRepository}
                hasOpenFiles={hasOpenFiles}
                isTerminalVisible={isTerminalVisible}
                shouldShowSidebar={shouldShowSidebar}
                isChatFullscreen={isChatFullscreen}
                currentTaskId={currentTaskId}
                currentTask={currentTask}
                messages={currentMessages}
                isHistoryOpen={isHistoryOpen}
                onHistoryOpenChange={setIsHistoryOpen}
                onTaskSelect={handleHistoryTaskSelect}
                onNewChat={handleNewChat}
                onToggleFullscreen={() => toggleFullscreen('chat')}
                chatBoxRef={chatBoxRef}
                rootPath={rootPath}
                currentFile={currentFile}
                onTaskStart={handleTaskStart}
                onDiffApplied={handleDiffApplied}
                onFileSelect={selectFile}
                onAddFileToChat={handleAddFileToChat}
                checkForConflicts={checkForConflicts}
              />
            )}
          </ResizablePanelGroup>
        </div>

        <GitStatusBar />
      </div>

      <RepositoryDialogs
        conflictData={conflictData}
        isProcessing={isWorktreeProcessing}
        mergeResult={mergeResult}
        syncResult={syncResult}
        onDiscard={handleDiscardAndContinue}
        onMerge={handleMergeAndContinue}
        onSync={handleSyncFromMain}
        onCancel={cancelOperation}
        onClose={resetWorktreeState}
        deleteConfirmation={deleteConfirmation}
        onCancelDelete={handleCancelDelete}
        onConfirmDelete={handleConfirmDelete}
      />
    </>
  );
}
