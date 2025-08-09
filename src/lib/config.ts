import fs from 'fs';
import path from 'path';
import os from 'os';
import { minimatch } from 'minimatch';
import type { CheckpointConfig as ICheckpointConfig } from '../types';

export class CheckpointConfig {
  private configPath: string;
  private _config: ICheckpointConfig;

  constructor(configPath?: string) {
    const hookDir = path.join(
      os.homedir(),
      '.claude',
      'hooks',
      'ixe1',
      'claude-code-checkpointing-hook'
    );
    this.configPath = configPath || path.join(hookDir, 'config.json');
    this._config = this.loadConfig();
  }

  private getDefaultConfig(): ICheckpointConfig {
    return {
      enabled: true,
      retention_days: 7,
      exclude_patterns: [
        '*.log',
        'node_modules/',
        '.env',
        '__pycache__/',
        '*.tmp',
        '.git/',
        'dist/',
        'build/',
        'coverage/',
        '*.swp',
        '*.swo',
        '.DS_Store',
        'Thumbs.db',
      ],
      max_file_size_mb: 100,
      checkpoint_on_stop: false,
      auto_cleanup: true,
    };
  }

  private loadConfig(): ICheckpointConfig {
    const defaultConfig = this.getDefaultConfig();

    try {
      if (fs.existsSync(this.configPath)) {
        const userConfig = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        return { ...defaultConfig, ...userConfig };
      } else {
        this._config = defaultConfig;
        this.saveConfig();
        return defaultConfig;
      }
    } catch (error) {
      console.error(`Error loading config: ${(error as Error).message}`);
      return defaultConfig;
    }
  }

  private saveConfig(): void {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this._config, null, 2));
    } catch (error) {
      console.error(`Error saving config: ${(error as Error).message}`);
    }
  }

  get enabled(): boolean {
    return this._config.enabled;
  }

  get retentionDays(): number {
    return this._config.retention_days;
  }

  get excludePatterns(): string[] {
    return this._config.exclude_patterns;
  }

  get maxFileSizeMb(): number {
    return this._config.max_file_size_mb;
  }

  get checkpointOnStop(): boolean {
    return this._config.checkpoint_on_stop;
  }

  get autoCleanup(): boolean {
    return this._config.auto_cleanup;
  }

  shouldExcludeFile(filePath: string): boolean {
    // Convert to relative path if absolute
    const relativePath = path.isAbsolute(filePath)
      ? path.relative(process.cwd(), filePath)
      : filePath;

    // Check if file matches any exclude pattern
    for (const pattern of this.excludePatterns) {
      if (minimatch(relativePath, pattern, { dot: true })) {
        return true;
      }

      // Also check if any parent directory matches
      const parts = relativePath.split(path.sep);
      for (let i = 0; i < parts.length; i++) {
        const partialPath = parts.slice(0, i + 1).join(path.sep);
        if (minimatch(partialPath, pattern, { dot: true })) {
          return true;
        }
      }
    }

    // Check file size if it exists
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.size > this.maxFileSizeMb * 1024 * 1024) {
          return true;
        }
      }
    } catch (error) {
      // Ignore stat errors
    }

    return false;
  }

  update(newConfig: Partial<ICheckpointConfig>): void {
    this._config = { ...this._config, ...newConfig };
    this.saveConfig();
  }

  reload(): void {
    this._config = this.loadConfig();
  }

  getConfig(): ICheckpointConfig {
    return { ...this._config };
  }
}

// Export singleton instance for convenience
export const defaultConfig = new CheckpointConfig();
