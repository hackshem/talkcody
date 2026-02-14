import { homeDir, join, sep } from '@tauri-apps/api/path';
import { exists, readTextFile } from '@tauri-apps/plugin-fs';
import { logger } from '@/lib/logger';

export class LogService {
  private logFileName = 'BXcOda.log';
  private legacyLogFileNames = ['TalkCody.log', 'talkcody.log'];

  /**
   * Get platform-specific log directory path
   */
  async getLogDirectoryPath(): Promise<string> {
    const platform = await import('@tauri-apps/plugin-os').then((os) => os.platform());
    const home = await homeDir();

    switch (platform) {
      case 'macos': // macOS
        return join(home, 'Library', 'Logs', 'com.bxcoda');
      case 'windows':
        // Windows
        return join(home, 'AppData', 'Local', 'com.bxcoda', 'logs');
      default: // Linux and others
        return join(home, '.local', 'share', 'com.bxcoda', 'logs');
    }
  }

  /**
   * Get TalkCody legacy log directory path for migration fallback
   */
  private async getLegacyLogDirectoryPath(): Promise<string> {
    const platform = await import('@tauri-apps/plugin-os').then((os) => os.platform());
    const home = await homeDir();

    switch (platform) {
      case 'macos':
        return join(home, 'Library', 'Logs', 'com.talkcody');
      case 'windows':
        return join(home, 'AppData', 'Local', 'com.talkcody', 'logs');
      default:
        return join(home, '.local', 'share', 'com.talkcody', 'logs');
    }
  }

  /**
   * Get full log file path
   */
  async getLogFilePath(): Promise<string> {
    const logDir = await this.getLogDirectoryPath();
    return join(logDir, this.logFileName);
  }

  /**
   * Get candidate log file paths in lookup order
   */
  private async getLogFileCandidates(): Promise<string[]> {
    const primaryDir = await this.getLogDirectoryPath();
    const legacyDir = await this.getLegacyLogDirectoryPath();

    const candidates = [
      await join(primaryDir, this.logFileName),
      await join(legacyDir, this.logFileName),
    ];

    for (const name of this.legacyLogFileNames) {
      candidates.push(await join(legacyDir, name));
    }

    return candidates;
  }

  /**
   * Read latest N lines from log file
   */
  async getLatestLogs(limit: number): Promise<string[]> {
    try {
      const candidates = await this.getLogFileCandidates();
      let logPath: string | null = null;

      for (const candidate of candidates) {
        if (await exists(candidate)) {
          logPath = candidate;
          break;
        }
      }

      if (!logPath) {
        logger.warn(`Log file does not exist. Checked paths: ${candidates.join(', ')}`);
        return [];
      }

      // Read the entire file (log files are typically not huge)
      const content = await readTextFile(logPath);
      const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');

      // Return last 'limit' lines
      return lines.slice(-limit);
    } catch (error) {
      logger.error('Failed to read logs:', error);
      return [];
    }
  }

  /**
   * Get log file path for display (formatted with ~)
   */
  async getDisplayLogFilePath(): Promise<string> {
    const logPath = await this.getLogFilePath();
    // Replace home directory with ~ for brevity
    const home = await homeDir();
    if (logPath.startsWith(home)) {
      const separator = sep();
      const relativePath = logPath.slice(home.length);
      // Remove leading separator if present, then add ~ with separator
      return `~${relativePath.startsWith(separator) ? relativePath : `${separator}${relativePath}`}`;
    }
    return logPath;
  }

  /**
   * Open log directory in file explorer
   */
  async openLogDirectory(): Promise<void> {
    try {
      const logDir = await this.getLogDirectoryPath();
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(logDir);
    } catch (error) {
      logger.error('Failed to open log directory:', error);
      throw error;
    }
  }
}

export const logService = new LogService();
