import fs from 'fs';
import path from 'path';
import os from 'os';

type LogLevel = 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG';

export class Logger {
  private readonly logFile: string;
  private readonly maxLogSize: number = 10 * 1024 * 1024; // 10MB

  constructor() {
    const hookDir = path.join(
      os.homedir(),
      '.claude',
      'hooks',
      'ixe1',
      'claude-code-checkpointing-hook'
    );
    this.logFile = path.join(hookDir, 'checkpoint.log');

    // Ensure log directory exists
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  private rotateLogIfNeeded(): void {
    try {
      if (fs.existsSync(this.logFile)) {
        const stats = fs.statSync(this.logFile);
        if (stats.size > this.maxLogSize) {
          const backupPath = `${this.logFile}.${Date.now()}.old`;
          fs.renameSync(this.logFile, backupPath);

          // Keep only the last 3 backup files
          const logDir = path.dirname(this.logFile);
          const files = fs.readdirSync(logDir);
          const backupFiles = files
            .filter((f) => f.startsWith(path.basename(this.logFile)) && f.endsWith('.old'))
            .map((f) => ({ name: f, path: path.join(logDir, f) }))
            .sort((a, b) => {
              const aTime = fs.statSync(a.path).mtime.getTime();
              const bTime = fs.statSync(b.path).mtime.getTime();
              return bTime - aTime;
            });

          // Remove old backups
          if (backupFiles.length > 3) {
            backupFiles.slice(3).forEach((f) => {
              fs.unlinkSync(f.path);
            });
          }
        }
      }
    } catch (error) {
      // Ignore rotation errors
    }
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${message}\n`;
  }

  private write(level: LogLevel, message: string): void {
    try {
      this.rotateLogIfNeeded();
      const formattedMessage = this.formatMessage(level, message);
      fs.appendFileSync(this.logFile, formattedMessage);
    } catch (error) {
      // Silently ignore logging errors to avoid disrupting the main process
    }
  }

  info(message: string): void {
    this.write('INFO', message);
  }

  warning(message: string): void {
    this.write('WARNING', message);
  }

  error(message: string): void {
    this.write('ERROR', message);
  }

  debug(message: string): void {
    if (process.env.DEBUG) {
      this.write('DEBUG', message);
    }
  }
}

// Export singleton instance
export const logger = new Logger();
