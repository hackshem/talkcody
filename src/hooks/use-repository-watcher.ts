import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef } from 'react';
import { logger } from '@/lib/logger';
import { fastDirectoryTreeService } from '@/services/fast-directory-tree-service';
import { useGitStore } from '@/stores/git-store';
import { useRepositoryStore } from '@/stores/repository-store';

const GIT_STATUS_DEBOUNCE_DELAY = 300; // ms
const FILE_TREE_DEBOUNCE_DELAY = 200; // ms

/**
 * Hook to set up file system watching for the currently open repository
 * This should be called in components that need to monitor file system changes
 */
export function useRepositoryWatcher() {
  const rootPath = useRepositoryStore((state) => state.rootPath);
  const refreshFileTree = useRepositoryStore((state) => state.refreshFileTree);

  // Use refs to store timeout IDs for proper cleanup and debouncing
  const gitStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileTreeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileChangeGitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Properly debounced git status refresh - cancels previous timeout
  const debouncedRefreshGitStatus = useCallback(() => {
    if (gitStatusTimeoutRef.current) {
      clearTimeout(gitStatusTimeoutRef.current);
    }

    gitStatusTimeoutRef.current = setTimeout(() => {
      useGitStore.getState().refreshStatus();
      gitStatusTimeoutRef.current = null;
    }, GIT_STATUS_DEBOUNCE_DELAY);
  }, []);

  // Properly debounced file tree refresh - cancels previous timeout
  const debouncedRefreshFileTree = useCallback(() => {
    if (fileTreeTimeoutRef.current) {
      clearTimeout(fileTreeTimeoutRef.current);
    }

    fileTreeTimeoutRef.current = setTimeout(() => {
      refreshFileTree();
      fileTreeTimeoutRef.current = null;
    }, FILE_TREE_DEBOUNCE_DELAY);
  }, [refreshFileTree]);

  // Properly debounced git status refresh for file changes - cancels previous timeout
  const debouncedRefreshGitStatusForFileChange = useCallback(() => {
    if (fileChangeGitTimeoutRef.current) {
      clearTimeout(fileChangeGitTimeoutRef.current);
    }

    fileChangeGitTimeoutRef.current = setTimeout(() => {
      useGitStore.getState().refreshStatus();
      fileChangeGitTimeoutRef.current = null;
    }, GIT_STATUS_DEBOUNCE_DELAY);
  }, []);

  useEffect(() => {
    if (!rootPath) {
      return;
    }

    // Start file watching
    const startWatching = async () => {
      try {
        await invoke('start_file_watching', { path: rootPath });
        logger.info('File watching started for:', rootPath);
      } catch (error) {
        logger.error('Failed to start file watching:', error);
      }
    };

    startWatching();

    // Listen for file system changes
    const unlistenFileSystem = listen('file-system-changed', (event) => {
      // Intelligently invalidate cache for changed paths
      const payload = event.payload as { path?: string };
      if (payload?.path) {
        fastDirectoryTreeService.invalidatePath(payload.path);

        // If the changed file is currently open, refresh its content
        const { openFiles, handleExternalFileChange } = useRepositoryStore.getState();
        const changedFilePath = payload.path;
        const isFileOpen = openFiles.some((file) => file.path === changedFilePath);
        if (isFileOpen) {
          setTimeout(() => {
            handleExternalFileChange(changedFilePath);
          }, 100);
        }
      }

      // Debounced refresh of file tree
      debouncedRefreshFileTree();

      // Also debounced refresh git status when working directory files change
      // This is needed because .git directory only changes on git add/commit,
      // but git status should reflect working directory changes immediately
      debouncedRefreshGitStatusForFileChange();
    });

    // Listen for git status changes (from .git directory watcher)
    const unlistenGitStatus = listen('git-status-changed', () => {
      debouncedRefreshGitStatus();
    });

    return () => {
      // Clear all pending timeouts on cleanup
      if (gitStatusTimeoutRef.current) {
        clearTimeout(gitStatusTimeoutRef.current);
        gitStatusTimeoutRef.current = null;
      }
      if (fileTreeTimeoutRef.current) {
        clearTimeout(fileTreeTimeoutRef.current);
        fileTreeTimeoutRef.current = null;
      }
      if (fileChangeGitTimeoutRef.current) {
        clearTimeout(fileChangeGitTimeoutRef.current);
        fileChangeGitTimeoutRef.current = null;
      }

      unlistenFileSystem.then((fn) => fn());
      unlistenGitStatus.then((fn) => fn());
      invoke('stop_file_watching').catch(logger.error);
    };
  }, [
    rootPath,
    debouncedRefreshGitStatus,
    debouncedRefreshFileTree,
    debouncedRefreshGitStatusForFileChange,
  ]);
}
