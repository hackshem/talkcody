import { invoke } from '@tauri-apps/api/core';
import { logger } from '@/lib/logger';
import { getValidatedWorkspaceRoot } from '@/services/workspace-root-service';

// Result from Rust backend execute_user_shell command
interface TauriShellResult {
  stdout: string;
  stderr: string;
  code: number;
  timed_out: boolean;
  idle_timed_out: boolean;
  pid: number | null;
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
}

// List of dangerous command patterns that should be blocked
const DANGEROUS_PATTERNS = [
  // File system destruction - Enhanced rm detection (not limited to absolute paths)
  /\brm\s+-[rf]/, // rm -r, rm -f, rm -rf (any path)
  /\brm\s+.*\*/, // rm with wildcards
  /\brm\s+\./, // rm . (current directory paths)
  /rm\s+.*-[rf]+.*\//, // rm with recursive or force flags on directories
  /rm\s+.*--recursive/,
  /rm\s+.*--force/,
  /rm\s+-[rf]{2}/, // rm -rf or rm -fr
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

// Commands where output IS the result - need full output
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

/**
 * BashExecutor - handles bash command execution with safety checks
 */
export class BashExecutor {
  private readonly logger = logger;

  /**
   * Check if a command is dangerous
   */
  private isDangerousCommand(command: string): {
    dangerous: boolean;
    reason?: string;
  } {
    const trimmedCommand = command.trim().toLowerCase();

    // Check for exact dangerous commands
    for (const dangerousCmd of DANGEROUS_COMMANDS) {
      if (trimmedCommand.startsWith(`${dangerousCmd} `) || trimmedCommand === dangerousCmd) {
        return {
          dangerous: true,
          reason: `Command "${dangerousCmd}" is not allowed for security reasons`,
        };
      }
    }

    // Check for dangerous patterns
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return {
          dangerous: true,
          reason: 'Command matches dangerous pattern and is not allowed for security reasons',
        };
      }
    }

    // Check for multiple command chaining with dangerous commands
    // Only split on actual command separators: && || ;
    // Don't split on single | as it's used in sed patterns and pipes
    if (command.includes('&&') || command.includes('||') || command.includes(';')) {
      const parts = command.split(/\s*(?:&&|\|\||;)\s*/);
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
   * Execute a bash command safely
   */
  async execute(command: string): Promise<BashResult> {
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
      const rootPath = await getValidatedWorkspaceRoot();
      if (rootPath) {
        this.logger.info('rootPath:', rootPath);
      } else {
        this.logger.info('No rootPath set, executing in default directory');
      }

      // Execute command
      const result = await this.executeCommand(command, rootPath || null);
      this.logger.info('Command result:', result);

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
   * Format execution result
   * Optimizes output based on command type:
   * - 'full': Commands where output IS the result (git, ls, cat, etc.) - return all output (up to 500 lines)
   * - 'minimal': Build/test commands - on success return minimal confirmation, on failure return full error
   * - 'default': Other commands - return last 30 lines on success
   */
  private formatResult(result: TauriShellResult, command: string): BashResult {
    // Success determination:
    // - If idle_timed_out, we consider it a success (process is still running in background)
    // - If timed_out (max timeout), it's a warning but could still be considered success
    // - Otherwise, command is successful only if exit code is 0
    const isSuccess = result.idle_timed_out || result.timed_out || result.code === 0;
    const strategy = getOutputStrategy(command);

    let message: string;
    let output: string | undefined;
    let error: string | undefined;

    if (result.idle_timed_out) {
      message = `Command running in background (idle timeout after 5s). PID: ${result.pid ?? 'unknown'}`;
      output = this.truncateOutput(result.stdout, 100);
      error = result.stderr || undefined;
    } else if (result.timed_out) {
      message = `Command timed out after max timeout. PID: ${result.pid ?? 'unknown'}`;
      output = this.truncateOutput(result.stdout, 100);
      error = result.stderr || undefined;
    } else if (result.code === 0) {
      // Success handling based on strategy
      message = 'Command executed successfully';

      switch (strategy) {
        case 'full':
          // Output IS the result - return full output (up to 500 lines)
          output = this.truncateOutput(result.stdout, 1000);
          break;
        case 'minimal':
          // Build/test success - minimal output
          output = result.stdout.trim() ? '(output truncated on success)' : undefined;
          break;
        default:
          // Default: return last 500 lines
          output = this.truncateOutput(result.stdout, 1000);
          break;
      }
      error = result.stderr || undefined;
    } else {
      // Failure: always show full error information regardless of strategy
      message = `Command failed with exit code ${result.code}`;
      if (result.stderr && result.stderr.trim()) {
        error = result.stderr;
        // Also include stdout if it contains useful info
        if (result.stdout.trim()) {
          output = this.truncateOutput(result.stdout, 50);
        }
      } else {
        output = this.truncateOutput(result.stdout, 50);
        error = undefined;
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
   * Truncate output to last N lines
   */
  private truncateOutput(stdout: string, maxLines: number): string | undefined {
    if (!stdout.trim()) {
      return undefined;
    }
    const lines = stdout.split('\n');
    if (lines.length > maxLines) {
      return `... (${lines.length - maxLines} lines truncated)\n${lines.slice(-maxLines).join('\n')}`;
    }
    return stdout;
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
}

// Export singleton instance for convenience
export const bashExecutor = new BashExecutor();
