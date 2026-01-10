import { Folder, ListTodo, Plus, Search } from 'lucide-react';
import type React from 'react';
import { memo } from 'react';
import { EmptyRepositoryState } from '@/components/empty-repository-state';
import { FileTree } from '@/components/file-tree';
import { FileTreeHeader } from '@/components/file-tree-header';
import { TaskList } from '@/components/task-list';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResizableHandle, ResizablePanel } from '@/components/ui/resizable';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/hooks/use-locale';
import type { Task } from '@/services/database-service';
import type { FileNode } from '@/types/file-system';
import { SidebarView } from '@/types/navigation';
import type { WorktreeInfo } from '@/types/worktree';

interface RepositorySidebarProps {
  emptyRepoPanelId: string;
  fileTreePanelId: string;
  shouldShowSidebar: boolean;
  hasRepository: boolean;
  sidebarView: SidebarView;
  onSidebarViewChange: (view: SidebarView) => void;
  currentProjectId: string;
  onProjectSelect: (projectId: string) => Promise<void>;
  onImportRepository: () => Promise<void>;
  onSelectRepository: () => Promise<void>;
  onOpenRepository: (path: string, projectId: string) => Promise<void>;
  isLoadingProject: boolean;
  isTerminalVisible?: boolean;
  onToggleTerminal?: () => void;
  onOpenFileSearch?: () => void;
  onOpenContentSearch?: () => void;
  rootPath: string | null;
  fileTree: FileNode | null;
  expandedPaths: Set<string>;
  selectedFilePath: string | null;
  onFileCreate: (parentPath: string, fileName: string, isDirectory: boolean) => Promise<void>;
  onFileDelete: (filePath: string) => Promise<void>;
  onFileRename: (oldPath: string, newName: string) => Promise<void>;
  onFileSelect: (filePath: string, lineNumber?: number) => void;
  onRefreshFileTree: () => void;
  onLoadChildren: (node: FileNode) => Promise<FileNode[]>;
  onToggleExpansion: (path: string) => void;
  taskSearchQuery: string;
  onTaskSearchQueryChange: (value: string) => void;
  isMaxReached: boolean;
  onNewChat: () => void;
  filteredTasks: Task[];
  tasksLoading: boolean;
  currentTaskId: string | null | undefined;
  editingId: string | null;
  editingTitle: string;
  onCancelEdit: () => void;
  onTaskSelect: (taskId: string) => void;
  onDeleteTask: (taskId: string, e?: React.MouseEvent) => void;
  onSaveEdit: (taskId: string) => void;
  onStartEditing: (task: Task, e?: React.MouseEvent) => void;
  onTitleChange: (title: string) => void;
  runningTaskIds: string[];
  getWorktreeForTask: (taskId: string) => WorktreeInfo | null;
}

export const RepositorySidebar = memo(function RepositorySidebar({
  emptyRepoPanelId,
  fileTreePanelId,
  shouldShowSidebar,
  hasRepository,
  sidebarView,
  onSidebarViewChange,
  currentProjectId,
  onProjectSelect,
  onImportRepository,
  onSelectRepository,
  onOpenRepository,
  isLoadingProject,
  isTerminalVisible,
  onToggleTerminal,
  onOpenFileSearch,
  onOpenContentSearch,
  rootPath,
  fileTree,
  expandedPaths,
  selectedFilePath,
  onFileCreate,
  onFileDelete,
  onFileRename,
  onFileSelect,
  onRefreshFileTree,
  onLoadChildren,
  onToggleExpansion,
  taskSearchQuery,
  onTaskSearchQueryChange,
  isMaxReached,
  onNewChat,
  filteredTasks,
  tasksLoading,
  currentTaskId,
  editingId,
  editingTitle,
  onCancelEdit,
  onTaskSelect,
  onDeleteTask,
  onSaveEdit,
  onStartEditing,
  onTitleChange,
  runningTaskIds,
  getWorktreeForTask,
}: RepositorySidebarProps) {
  const t = useTranslation();
  const panelId = shouldShowSidebar ? fileTreePanelId : emptyRepoPanelId;

  return (
    <>
      <ResizablePanel
        id={panelId}
        order={1}
        className={
          shouldShowSidebar
            ? 'border-r bg-white dark:bg-gray-950'
            : 'flex items-center justify-center bg-white dark:bg-gray-950'
        }
        defaultSize={shouldShowSidebar ? 20 : 50}
        maxSize={shouldShowSidebar ? 40 : 70}
        minSize={shouldShowSidebar ? 10 : 30}
      >
        {shouldShowSidebar ? (
          <div className="flex h-full flex-col">
            <FileTreeHeader
              currentProjectId={currentProjectId}
              onProjectSelect={onProjectSelect}
              onImportRepository={onImportRepository}
              isLoadingProject={isLoadingProject}
              isTerminalVisible={hasRepository ? isTerminalVisible : undefined}
              onToggleTerminal={hasRepository ? onToggleTerminal : undefined}
              onOpenFileSearch={hasRepository ? onOpenFileSearch : undefined}
              onOpenContentSearch={hasRepository ? onOpenContentSearch : undefined}
            />

            {hasRepository && (
              <div className=" border-b px-2 py-1">
                <Tabs
                  value={sidebarView}
                  onValueChange={(value) => {
                    onSidebarViewChange(value as SidebarView);
                  }}
                >
                  <TabsList className="grid w-full grid-cols-2 h-7 bg-muted/50 p-0.5">
                    <TabsTrigger
                      value={SidebarView.FILES}
                      className="h-6 gap-1.5 px-2.5 text-[11px] data-[state=active]:shadow-none"
                    >
                      <Folder className="h-3.5 w-3.5" />
                      {t.Sidebar.files}
                    </TabsTrigger>
                    <TabsTrigger
                      value={SidebarView.TASKS}
                      className="h-6 gap-1.5 px-2.5 text-[11px] data-[state=active]:shadow-none"
                    >
                      <ListTodo className="h-3.5 w-3.5" />
                      {t.Sidebar.tasks}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            )}

            {hasRepository && (
              <div
                className={sidebarView === SidebarView.FILES ? 'flex-1 overflow-auto' : 'hidden'}
              >
                {fileTree && rootPath && (
                  <FileTree
                    key={rootPath}
                    fileTree={fileTree}
                    repositoryPath={rootPath}
                    expandedPaths={expandedPaths}
                    onFileCreate={onFileCreate}
                    onFileDelete={onFileDelete}
                    onFileRename={onFileRename}
                    onFileSelect={onFileSelect}
                    onRefresh={onRefreshFileTree}
                    selectedFile={selectedFilePath}
                    onLoadChildren={async (node) => {
                      await onLoadChildren(node);
                      return node.children || [];
                    }}
                    onToggleExpansion={onToggleExpansion}
                  />
                )}
              </div>
            )}

            <div
              className={
                !hasRepository || sidebarView === SidebarView.TASKS
                  ? 'flex flex-1 flex-col overflow-hidden'
                  : 'hidden'
              }
            >
              <div className="flex items-center gap-2 border-b p-2">
                <div className="relative flex-1">
                  <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 h-3.5 w-3.5 text-gray-400" />
                  <Input
                    className="h-8 pl-8 text-xs"
                    onChange={(event) => onTaskSearchQueryChange(event.target.value)}
                    placeholder={t.Chat.searchTasks}
                    value={taskSearchQuery}
                  />
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className="h-8 w-8 p-0"
                      disabled={isMaxReached}
                      onClick={onNewChat}
                      size="sm"
                      variant="outline"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  {isMaxReached && (
                    <TooltipContent>
                      <p>{t.RepositoryLayout.maxConcurrentTasksReached}</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </div>

              <div className="flex-1 overflow-auto">
                <TaskList
                  tasks={filteredTasks}
                  currentTaskId={currentTaskId ?? undefined}
                  editingId={editingId}
                  editingTitle={editingTitle}
                  loading={tasksLoading}
                  getWorktreeForTask={getWorktreeForTask}
                  onCancelEdit={onCancelEdit}
                  onTaskSelect={onTaskSelect}
                  onDeleteTask={onDeleteTask}
                  onSaveEdit={onSaveEdit}
                  onStartEditing={onStartEditing}
                  onTitleChange={onTitleChange}
                  runningTaskIds={runningTaskIds}
                />
              </div>
            </div>
          </div>
        ) : (
          <EmptyRepositoryState
            isLoading={isLoadingProject}
            onSelectRepository={onSelectRepository}
            onOpenRepository={onOpenRepository}
          />
        )}
      </ResizablePanel>

      <ResizableHandle withHandle />
    </>
  );
});
