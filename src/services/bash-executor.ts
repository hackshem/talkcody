import { invoke } from '@tauri-apps/api/core';
import { isAbsolute, join } from '@tauri-apps/api/path';
import { logger } from '@/lib/logger';
import { isPathWithinProjectDirectory } from '@/lib/utils/path-security';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';

// Result from Rust backend execute_user_shell command
interface TauriShellResult {
  stdout: string;
  stderr: string;
  code: number;
  timed_out: boolean;
  idle_timed_out: boolean;
  pid: number | null;
}

// Result from Rust backend search_files_by_glob command
interface GlobResult {
  path: string;
  /** Canonical (resolved) path - resolves symlinks to their real location */
  canonical_path: string;
  is_directory: boolean;
  modified_time: number;
}

export interface BashResult {
  success: boolean;
  message: string;
  command: string;
  output?: string;
  error?: string;
  exit_code?: number;
  timed_out?: boolean;
  idle_timed_out?: boolean;
  pid?: number | null;
  taskId?: string; // Background task ID if running in background
  isBackground?: boolean; // Whether command is running in background
}

// Commands where output IS the result - need full output (max 10000 chars)
const OUTPUT_IS_RESULT_PATTERNS = [
  /^git\s+(status|log|diff|show|branch|remote|config|rev-parse|ls-files|blame|describe|tag)/,
  /^(ls|dir|find|tree|exa|lsd)\b/,
  /^(cat|head|tail|grep|rg|ag|ack|sed|awk)\b/,
  /^(curl|wget|http|httpie)\b/,
  /^(echo|printf)\b/,
  /^(pwd|whoami|hostname|uname|id|groups)\b/,
  /^(env|printenv|set)\b/,
  /^(which|where|type|command)\b/,
  /^(jq|yq|xq)\b/, // JSON/YAML processors
  /^(wc|sort|uniq|cut|tr|column)\b/, // Text processing
  /^(date|cal|uptime)\b/,
  /^(df|du|free|top|ps|lsof)\b/, // System info
  /^(npm\s+(list|ls|outdated|view|info|search))\b/,
  /^(yarn\s+(list|info|why))\b/,
  /^(bun\s+(pm\s+ls|pm\s+cache))\b/,
  /^(cargo\s+(tree|metadata|search))\b/,
  /^(pip\s+(list|show|freeze))\b/,
  /^(docker\s+(ps|images|inspect|logs))\b/,
];

// Build/test commands - minimal output on success
const BUILD_TEST_PATTERNS = [
  /^(npm|yarn|pnpm|bun)\s+(run\s+)?(test|build|lint|check|typecheck|tsc|compile)/,
  /^(cargo|rustc)\s+(test|build|check|clippy)/,
  /^(go)\s+(test|build|vet)/,
  /^(pytest|jest|vitest|mocha|ava|tap)\b/,
  /^(make|cmake|ninja)\b/,
  /^(tsc|eslint|prettier|biome)\b/,
  /^(gradle|mvn|ant)\b/,
  /^(dotnet)\s+(build|test|run)/,
];

type OutputStrategy = 'full' | 'minimal' | 'default';

/**
 * Determine output strategy based on command type
 */
function getOutputStrategy(command: string): OutputStrategy {
  const trimmedCommand = command.trim();

  if (OUTPUT_IS_RESULT_PATTERNS.some((re) => re.test(trimmedCommand))) {
    return 'full';
  }
  if (BUILD_TEST_PATTERNS.some((re) => re.test(trimmedCommand))) {
    return 'minimal';
  }
  return 'default';
}

// List of dangerous command patterns that should be blocked
// Note: rm -rf is NOT blocked here - it's validated by validateRmCommand() which checks:
// 1. Workspace root exists
// 2. Directory is inside a Git repository
// 3. All target paths are within workspace
// Note: rm with wildcards is now handled by validateWildcardRmCommand() which:
// 1. Expands wildcards using Rust backend glob
// 2. Validates all expanded paths are within workspace
const DANGEROUS_PATTERNS = [
  // File system destruction - rm patterns that are always dangerous
  /\brm\b.*\s\.(?:\/)?(?:\s|$)/, // rm . or rm -rf . (current directory)
  /rmdir\s+.*-.*r/, // rmdir with recursive

  // Other file deletion commands
  /\bunlink\s+/,
  /\bshred\s+/,
  /\btruncate\s+.*-s\s*0/, // truncate to zero

  // find + delete combinations
  /\bfind\s+.*-delete/,
  /\bfind\s+.*-exec\s+rm/,
  /\bfind\s+.*\|\s*xargs\s+rm/,

  // File content clearing
  /^>\s*\S+/, // > file (clear file)
  /cat\s+\/dev\/null\s*>/, // cat /dev/null > file

  // Git dangerous operations
  /\bgit\s+clean\s+-[fd]/,
  /\bgit\s+reset\s+--hard/,

  // mv to dangerous locations
  /\bmv\s+.*\/dev\/null/,

  // Format commands (disk formatting, not code formatters)
  /mkfs\./,
  /\bformat\s+[a-zA-Z]:/, // Windows format drive command (format C:, format D:, etc.)
  /fdisk/,
  /parted/,
  /gparted/,

  // System control
  /shutdown/,
  /reboot/,
  /halt/,
  /poweroff/,
  /init\s+[016]/,

  // Dangerous dd operations
  /dd\s+.*of=\/dev/,

  // Permission changes that could be dangerous
  /chmod\s+.*777\s+\//,
  /chmod\s+.*-R.*777/,
  /chown\s+.*-R.*root/,

  // Network and system modification
  /iptables/,
  /ufw\s+.*disable/,
  /systemctl\s+.*stop/,
  /service\s+.*stop/,

  // Package managers with dangerous operations
  /apt\s+.*purge/,
  /yum\s+.*remove/,
  /brew\s+.*uninstall.*--force/,

  // Disk operations
  /mount\s+.*\/dev/,
  /umount\s+.*-f/,
  /fsck\s+.*-y/,

  // Process killing
  /killall\s+.*-9/,
  /pkill\s+.*-9.*init/,

  // Cron modifications
  /crontab\s+.*-r/,

  // History manipulation
  /history\s+.*-c/,
  />\s*~\/\.bash_history/,

  // Dangerous redirections
  />\s*\/dev\/sd[a-z]/,
  />\s*\/dev\/nvme/,
  />\s*\/etc\//,

  // Kernel and system files
  /modprobe\s+.*-r/,
  /insmod/,
  /rmmod/,

  // Dangerous curl/wget operations
  /curl\s+.*\|\s*(sh|bash|zsh)/,
  /wget\s+.*-O.*\|\s*(sh|bash|zsh)/,
];

// Additional dangerous commands (exact matches)
const DANGEROUS_COMMANDS = [
  'dd',
  'mkfs',
  'fdisk',
  'parted',
  'gparted',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'su',
  'sudo su',
  'unlink',
  'shred',
  'truncate',
];

/**
 * BashExecutor - handles bash command execution with safety checks
 */
export class BashExecutor {
  private readonly logger = logger;

  /**
   * Extract command parts excluding heredoc content
   * Heredoc syntax: << DELIMITER or <<- DELIMITER or << 'DELIMITER' or << "DELIMITER"
   * Content between << DELIMITER and DELIMITER should not be checked as commands
   * But commands AFTER the heredoc delimiter MUST be checked
   */
  private extractCommandExcludingHeredocContent(command: string): string {
    // Match heredoc start: << or <<- followed by optional quotes and delimiter
    const heredocMatch = command.match(/<<-?\s*['"]?(\w+)['"]?/);
    if (!heredocMatch) {
      return command;
    }

    const delimiter = heredocMatch[1];
    const heredocStartIndex = command.indexOf('<<');

    // Get the part before heredoc
    const beforeHeredoc = command.slice(0, heredocStartIndex);

    // Find the end of heredoc (delimiter on its own line)
    // The delimiter must be at the start of a line (after newline) and may have trailing whitespace
    const afterHeredocStart = command.slice(heredocStartIndex + heredocMatch[0].length);
    const delimiterPattern = new RegExp(`\\n${delimiter}\\s*(?:\\n|$)`);
    const delimiterMatch = afterHeredocStart.match(delimiterPattern);

    if (!delimiterMatch || delimiterMatch.index === undefined) {
      // No closing delimiter found, only check the part before heredoc
      return beforeHeredoc;
    }

    // Get commands after the heredoc delimiter
    const afterHeredoc = afterHeredocStart.slice(delimiterMatch.index + delimiterMatch[0].length);

    // Recursively process in case there are more heredocs
    const processedAfter = this.extractCommandExcludingHeredocContent(afterHeredoc);

    return `${beforeHeredoc} ${processedAfter}`;
  }

  /**
   * Check if a command is dangerous
   */
  private isDangerousCommand(command: string): {
    dangerous: boolean;
    reason?: string;
  } {
    // Extract command excluding heredoc content - heredoc content should not be checked
    // but commands after heredoc must still be checked
    const commandToCheck = this.extractCommandExcludingHeredocContent(command);
    const trimmedCommand = commandToCheck.trim().toLowerCase();

    // Check for exact dangerous commands
    for (const dangerousCmd of DANGEROUS_COMMANDS) {
      if (trimmedCommand.startsWith(`${dangerousCmd} `) || trimmedCommand === dangerousCmd) {
        return {
          dangerous: true,
          reason: `Command "${dangerousCmd}" is not allowed for security reasons`,
        };
      }
    }

    // Check for dangerous patterns (use commandToCheck to exclude heredoc content)
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(commandToCheck)) {
        return {
          dangerous: true,
          reason: 'Command matches dangerous pattern and is not allowed for security reasons',
        };
      }
    }

    // Check for multiple command chaining with dangerous commands
    // Only split on actual command separators: && || ;
    // Don't split on single | as it's used in sed patterns and pipes
    // Use commandToCheck to avoid splitting heredoc content
    if (
      commandToCheck.includes('&&') ||
      commandToCheck.includes('||') ||
      commandToCheck.includes(';')
    ) {
      const parts = commandToCheck.split(/\s*(?:&&|\|\||;)\s*/);
      for (const part of parts) {
        const partCheck = this.isDangerousCommand(part.trim());
        if (partCheck.dangerous) {
          return partCheck;
        }
      }
    }

    return { dangerous: false };
  }

  /**
   * Extract paths from rm command
   * Returns an array of paths that the rm command targets
   */
  private extractRmPaths(command: string): string[] {
    // Match rm command with optional flags
    // rm [-options] path1 [path2 ...]
    const rmMatch = command.match(/\brm\s+(.+)/);
    if (!rmMatch) {
      return [];
    }

    const args = rmMatch[1] ?? '';
    const paths: string[] = [];

    // Split by spaces, but respect quoted strings
    const parts = args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];

    for (const part of parts) {
      // Skip flags (start with -)
      if (part.startsWith('-')) {
        continue;
      }
      // Remove surrounding quotes if present
      const cleanPath = part.replace(/^["']|["']$/g, '');
      if (cleanPath) {
        paths.push(cleanPath);
      }
    }

    return paths;
  }

  /**
   * Check if a path is within the workspace directory
   */
  private async isPathWithinWorkspace(targetPath: string, workspaceRoot: string): Promise<boolean> {
    // If the path is relative, it's relative to the workspace
    const isAbs = await isAbsolute(targetPath);
    if (!isAbs) {
      // Relative paths are allowed, but we need to resolve them first to check for ../ escapes
      const resolvedPath = await join(workspaceRoot, targetPath);
      return await isPathWithinProjectDirectory(resolvedPath, workspaceRoot);
    }

    // Check if the absolute path is within the workspace
    return await isPathWithinProjectDirectory(targetPath, workspaceRoot);
  }

  /**
   * Extract wildcard patterns from rm command arguments
   * Separates wildcards from explicit paths and flags
   */
  private extractWildcardPatterns(command: string): {
    wildcardPaths: string[];
    explicitPaths: string[];
    flags: string[];
    hasWildcards: boolean;
  } {
    const rmMatch = command.match(/\brm\s+(.+)/);
    if (!rmMatch) {
      return { wildcardPaths: [], explicitPaths: [], flags: [], hasWildcards: false };
    }

    const args = rmMatch[1] ?? '';
    const parts = args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];

    const wildcardPaths: string[] = [];
    const explicitPaths: string[] = [];
    const flags: string[] = [];

    for (const part of parts) {
      if (part.startsWith('-')) {
        flags.push(part);
        continue;
      }

      const cleanPath = part.replace(/^["']|["']$/g, '');
      if (!cleanPath) continue;

      // Check for wildcard characters: *, ?, [, {
      if (/[*?[{]/.test(cleanPath)) {
        wildcardPaths.push(cleanPath);
      } else {
        explicitPaths.push(cleanPath);
      }
    }

    return {
      wildcardPaths,
      explicitPaths,
      flags,
      hasWildcards: wildcardPaths.length > 0,
    };
  }

  /**
   * Get the base path before wildcard characters
   * "../src/*.ts" -> "../src"
   * "*.ts" -> null (pattern starts with wildcard)
   * "/abs/path/**\/*.js" -> "/abs/path"
   */
  private getPatternBasePath(pattern: string): string | null {
    const wildcardIndex = pattern.search(/[*?[{]/);
    if (wildcardIndex === -1) return pattern;
    if (wildcardIndex === 0) return null;

    // Find the last directory separator before the wildcard
    const beforeWildcard = pattern.substring(0, wildcardIndex);
    const lastSep = Math.max(beforeWildcard.lastIndexOf('/'), beforeWildcard.lastIndexOf('\\'));

    // Handle root directory case: /* -> /
    if (lastSep === 0 && pattern.startsWith('/')) {
      return '/';
    }

    return lastSep > 0 ? beforeWildcard.substring(0, lastSep) : null;
  }

  /**
   * Expand wildcard patterns to actual file paths using Rust backend
   * Returns canonical (resolved) paths to prevent symlink attacks
   */
  private async expandWildcards(pattern: string, workspaceRoot: string): Promise<string[]> {
    try {
      const results = await invoke<GlobResult[]>('search_files_by_glob', {
        pattern,
        path: workspaceRoot,
        maxResults: 10000, // Safety limit
      });

      // Use canonical_path (resolved symlinks) for security validation
      // This prevents symlink attacks where a symlink inside workspace points to external files
      return results.map((r) => r.canonical_path);
    } catch (error) {
      this.logger.warn('Failed to expand wildcard pattern:', pattern, error);
      return [];
    }
  }

  /**
   * Validate rm command with wildcards
   * Expands wildcards and validates all resulting paths are within workspace
   */
  private async validateWildcardRmCommand(
    command: string,
    workspaceRoot: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    const extracted = this.extractWildcardPatterns(command);

    if (!extracted.hasWildcards) {
      return { allowed: true }; // No wildcards, use existing validation
    }

    // Validate that wildcard patterns themselves don't escape workspace
    for (const pattern of extracted.wildcardPaths) {
      // Check for path traversal BEFORE the wildcard
      // e.g., "../../*.txt" or "/tmp/../home/*"
      const basePath = this.getPatternBasePath(pattern);
      if (basePath) {
        const isWithin = await this.isPathWithinWorkspace(basePath, workspaceRoot);
        if (!isWithin) {
          return {
            allowed: false,
            reason: `rm command blocked: wildcard pattern "${pattern}" references path outside workspace`,
          };
        }
      }
    }

    // Expand all wildcards and validate each expanded path
    for (const pattern of extracted.wildcardPaths) {
      // Resolve relative patterns against workspace root
      const isAbs = await isAbsolute(pattern);
      const fullPattern = isAbs ? pattern : await join(workspaceRoot, pattern);
      const expandedPaths = await this.expandWildcards(fullPattern, workspaceRoot);

      // If pattern matches nothing, let shell handle it (will show error)
      if (expandedPaths.length === 0) {
        continue;
      }

      // Validate EACH expanded path
      for (const expandedPath of expandedPaths) {
        const isWithin = await this.isPathWithinWorkspace(expandedPath, workspaceRoot);
        if (!isWithin) {
          return {
            allowed: false,
            reason: `rm command blocked: wildcard "${pattern}" would match "${expandedPath}" which is outside workspace`,
          };
        }
      }
    }

    // Also validate explicit paths
    for (const explicitPath of extracted.explicitPaths) {
      const isWithin = await this.isPathWithinWorkspace(explicitPath, workspaceRoot);
      if (!isWithin) {
        return {
          allowed: false,
          reason: `rm command blocked: path "${explicitPath}" is outside workspace`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check if the command contains rm and validate the paths
   * Returns error message if rm is not allowed, null if allowed
   */
  private async validateRmCommand(
    command: string,
    workspaceRoot: string | null
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Check if command contains rm (excluding heredoc content)
    const commandToCheck = this.extractCommandExcludingHeredocContent(command);

    // Simple check for rm command presence
    if (!/\brm\b/.test(commandToCheck)) {
      return { allowed: true };
    }

    // If no workspace root is set, rm is not allowed
    if (!workspaceRoot) {
      return {
        allowed: false,
        reason: 'rm command is not allowed: no workspace root is set',
      };
    }

    // Check if workspace is a git repository by checking for .git directory
    try {
      const result = await invoke<TauriShellResult>('execute_user_shell', {
        command: 'git rev-parse --is-inside-work-tree',
        cwd: workspaceRoot,
        timeoutMs: 5000,
      });

      if (result.code !== 0 || result.stdout.trim() !== 'true') {
        return {
          allowed: false,
          reason: 'rm command is only allowed in git repositories',
        };
      }
    } catch {
      return {
        allowed: false,
        reason: 'rm command is only allowed in git repositories (git check failed)',
      };
    }

    // Extract and validate paths from rm command
    // Need to check each part of the command that might contain rm
    const commandParts = commandToCheck.split(/\s*(?:&&|\|\||;)\s*/);

    for (const part of commandParts) {
      const trimmedPart = part.trim();
      if (!/\brm\b/.test(trimmedPart)) {
        continue;
      }

      // Check for wildcards first - use specialized validation
      const extracted = this.extractWildcardPatterns(trimmedPart);

      if (extracted.hasWildcards) {
        const wildcardResult = await this.validateWildcardRmCommand(trimmedPart, workspaceRoot);
        if (!wildcardResult.allowed) {
          return wildcardResult;
        }
        // Wildcard validation passed, continue to next part
        continue;
      }

      // No wildcards - use existing explicit path validation
      const paths = this.extractRmPaths(trimmedPart);

      if (paths.length === 0) {
        // rm without paths is likely an error, let it through and shell will handle it
        continue;
      }

      for (const targetPath of paths) {
        const isWithin = await this.isPathWithinWorkspace(targetPath, workspaceRoot);
        if (!isWithin) {
          return {
            allowed: false,
            reason: `rm command blocked: path "${targetPath}" is outside the workspace directory`,
          };
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Execute a bash command safely
   * @param command - The bash command to execute
   * @param taskId - The task ID for workspace root resolution
   * @param toolUseId - Optional tool use ID for output file naming
   */
  async execute(command: string, taskId: string, toolId: string): Promise<BashResult> {
    try {
      // Safety check
      const dangerCheck = this.isDangerousCommand(command);
      if (dangerCheck.dangerous) {
        this.logger.warn('Blocked dangerous command:', command);
        return {
          success: false,
          command,
          message: `Command blocked: ${dangerCheck.reason}`,
          error: dangerCheck.reason,
        };
      }

      this.logger.info('Executing bash command:', command);
      const rootPath = await getEffectiveWorkspaceRoot(taskId);

      // Validate rm command paths
      const rmValidation = await this.validateRmCommand(command, rootPath || null);
      if (!rmValidation.allowed) {
        this.logger.warn('Blocked rm command:', command, rmValidation.reason);
        return {
          success: false,
          command,
          message: `Command blocked: ${rmValidation.reason}`,
          error: rmValidation.reason,
        };
      }
      if (rootPath) {
        this.logger.info('rootPath:', rootPath);
      } else {
        this.logger.info('No rootPath set, executing in default directory');
      }

      const result = await this.executeCommand(command, rootPath || null, 300000, 60000);

      return this.formatResult(result, command);
    } catch (error) {
      return this.handleError(error, command);
    }
  }

  /**
   * Execute command via Tauri backend
   * @param command - The command to execute
   * @param cwd - Working directory
   * @param timeoutMs - Maximum timeout in milliseconds (default: 120000 = 2 minutes)
   * @param idleTimeoutMs - Idle timeout in milliseconds (default: 5000 = 5 seconds)
   */
  private async executeCommand(
    command: string,
    cwd: string | null,
    timeoutMs?: number,
    idleTimeoutMs?: number
  ): Promise<TauriShellResult> {
    return await invoke<TauriShellResult>('execute_user_shell', {
      command,
      cwd,
      timeoutMs,
      idleTimeoutMs,
    });
  }

  /**
   * Format execution result based on command type strategy
   */
  private formatResult(result: TauriShellResult, command: string): BashResult {
    const isSuccess = result.idle_timed_out || result.timed_out || result.code === 0;
    const strategy = getOutputStrategy(command);

    let message: string;
    let output: string | undefined;
    let error: string | undefined;

    if (result.idle_timed_out) {
      message = `Command running in background (idle timeout after 5s). PID: ${result.pid ?? 'unknown'}`;
      output = this.truncateByChars(result.stdout, 10000);
      error = result.stderr || undefined;
    } else if (result.timed_out) {
      message = `Command timed out after max timeout. PID: ${result.pid ?? 'unknown'}`;
      output = this.truncateByChars(result.stdout, 10000);
      error = result.stderr || undefined;
    } else if (result.code === 0) {
      message = 'Command executed successfully';

      switch (strategy) {
        case 'full':
          // Output IS the result - return up to 10000 chars
          output = this.truncateByChars(result.stdout, 10000);
          break;
        case 'minimal':
          // Build/test success - minimal output
          output = result.stdout.trim() ? '(output truncated on success)' : undefined;
          break;
        default:
          // Default: return up to 10000 chars
          output = this.truncateByChars(result.stdout, 10000);
          break;
      }
      error = result.stderr || undefined;
    } else {
      // Failure: always show full error information
      message = `Command failed with exit code ${result.code}`;
      if (result.stderr?.trim()) {
        error = this.truncateByChars(result.stderr, 10000);
        // Also include stdout if it contains useful info
        if (result.stdout.trim()) {
          output = this.truncateByChars(result.stdout, 5000);
        }
      } else {
        output = this.truncateByChars(result.stdout, 10000);
      }
    }

    return {
      success: isSuccess,
      command,
      message,
      output,
      error,
      exit_code: result.code,
      timed_out: result.timed_out,
      idle_timed_out: result.idle_timed_out,
      pid: result.pid,
    };
  }

  /**
   * Truncate output to max N characters (from the end)
   */
  private truncateByChars(text: string, maxChars: number): string | undefined {
    if (!text.trim()) {
      return undefined;
    }
    if (text.length > maxChars) {
      const truncatedCount = text.length - maxChars;
      return `... (${truncatedCount} chars truncated)\n${text.slice(-maxChars)}`;
    }
    return text;
  }

  /**
   * Handle execution errors
   */
  private handleError(error: unknown, command: string): BashResult {
    this.logger.error('Error executing bash command:', error);
    return {
      success: false,
      command,
      message: 'Error executing bash command',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  /**
   * Execute a bash command in the background
   * @param command - The bash command to execute
   * @param taskId - The task ID for workspace root resolution
   * @param toolId - Optional tool use ID for output file naming
   * @param maxTimeoutMs - Optional timeout in milliseconds (default: 2 hours)
   */
  async executeInBackground(
    command: string,
    taskId: string,
    toolId: string,
    maxTimeoutMs?: number
  ): Promise<BashResult> {
    try {
      // Safety check
      const dangerCheck = this.isDangerousCommand(command);
      if (dangerCheck.dangerous) {
        this.logger.warn('Blocked dangerous command:', command);
        return {
          success: false,
          command,
          message: `Command blocked: ${dangerCheck.reason}`,
          error: dangerCheck.reason,
        };
      }

      this.logger.info('Executing background bash command:', command);
      const rootPath = await getEffectiveWorkspaceRoot(taskId);

      // Validate rm command paths
      const rmValidation = await this.validateRmCommand(command, rootPath || null);
      if (!rmValidation.allowed) {
        this.logger.warn('Blocked rm command:', command, rmValidation.reason);
        return {
          success: false,
          command,
          message: `Command blocked: ${rmValidation.reason}`,
          error: rmValidation.reason,
        };
      }

      // Import the background task store dynamically to avoid circular dependency
      const { useBackgroundTaskStore } = await import('@/stores/background-task-store');

      // Generate effective tool use ID
      const effectiveToolUseId = toolId?.trim()
        ? toolId.trim()
        : `bash_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      // Spawn the background task
      const taskIdResult = await useBackgroundTaskStore
        .getState()
        .spawnTask(command, taskId, effectiveToolUseId, rootPath || undefined, maxTimeoutMs);

      this.logger.info('Background task spawned:', taskIdResult);

      return {
        success: true,
        command,
        message: `Command started in background (Task ID: ${taskIdResult})`,
        pid: undefined, // Will be available after first status refresh
        taskId: taskIdResult,
        isBackground: true,
      };
    } catch (error) {
      this.logger.error('Error executing background bash command:', error);
      return {
        success: false,
        command,
        message: 'Error executing background bash command',
        error: error instanceof Error ? error.message : String(error),
        isBackground: true,
      };
    }
  }
}

// Export singleton instance for convenience
export const bashExecutor = new BashExecutor();
