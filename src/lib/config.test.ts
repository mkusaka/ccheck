import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { CheckpointConfig } from './config';

vi.mock('fs');
vi.mock('os', () => ({
  default: {
    homedir: vi.fn(() => '/mock/home')
  },
  homedir: vi.fn(() => '/mock/home')
}));

describe('CheckpointConfig', () => {
  let config: CheckpointConfig;
  const mockHomedir = '/mock/home';
  const mockConfigPath = path.join(
    mockHomedir,
    '.claude',
    'hooks',
    'ixe1',
    'claude-code-checkpointing-hook',
    'config.json'
  );

  beforeEach(() => {
    vi.clearAllMocks();
    (os.homedir as ReturnType<typeof vi.fn>).mockReturnValue(mockHomedir);
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (fs.mkdirSync as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);
    (fs.writeFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use default config when config file does not exist', () => {
      config = new CheckpointConfig();
      expect(config.enabled).toBe(true);
      expect(config.retentionDays).toBe(7);
      expect(config.maxFileSizeMb).toBe(100);
      expect(config.autoCleanup).toBe(true);
      expect(config.checkpointOnStop).toBe(false);
    });

    it('should create config file with defaults when it does not exist', () => {
      config = new CheckpointConfig();
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        mockConfigPath,
        expect.stringContaining('"enabled": true')
      );
    });

    it('should load user config when file exists', () => {
      const userConfig = {
        enabled: false,
        retention_days: 14,
        exclude_patterns: ['*.test'],
        max_file_size_mb: 50,
        checkpoint_on_stop: true,
        auto_cleanup: false,
      };
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(userConfig));

      config = new CheckpointConfig();
      expect(config.enabled).toBe(false);
      expect(config.retentionDays).toBe(14);
      expect(config.maxFileSizeMb).toBe(50);
    });

    it('should merge user config with defaults', () => {
      const partialUserConfig = {
        enabled: false,
        retention_days: 14,
      };
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
        JSON.stringify(partialUserConfig)
      );

      config = new CheckpointConfig();
      expect(config.enabled).toBe(false);
      expect(config.retentionDays).toBe(14);
      expect(config.maxFileSizeMb).toBe(100); // From default
      expect(config.excludePatterns).toContain('*.log'); // From default
    });

    it('should use custom config path if provided', () => {
      const customPath = '/custom/config.json';
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      config = new CheckpointConfig(customPath);
      expect(fs.writeFileSync).toHaveBeenCalledWith(customPath, expect.any(String));
    });
  });

  describe('shouldExcludeFile', () => {
    beforeEach(() => {
      config = new CheckpointConfig();
    });

    it('should exclude files matching patterns', () => {
      expect(config.shouldExcludeFile('test.log')).toBe(true);
      expect(config.shouldExcludeFile('node_modules/package.json')).toBe(true);
      expect(config.shouldExcludeFile('.env')).toBe(true);
      expect(config.shouldExcludeFile('dist/index.js')).toBe(true);
    });

    it('should not exclude files not matching patterns', () => {
      expect(config.shouldExcludeFile('index.js')).toBe(false);
      expect(config.shouldExcludeFile('src/app.ts')).toBe(false);
    });

    it('should handle absolute paths', () => {
      const cwd = process.cwd();
      const absolutePath = path.join(cwd, 'test.log');
      expect(config.shouldExcludeFile(absolutePath)).toBe(true);
    });

    it('should exclude files larger than max size', () => {
      const filePath = 'large-file.txt';
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.statSync as ReturnType<typeof vi.fn>).mockReturnValue({
        size: 101 * 1024 * 1024, // 101MB
      } as fs.Stats);

      expect(config.shouldExcludeFile(filePath)).toBe(true);
    });

    it('should not exclude files smaller than max size', () => {
      const filePath = 'small-file.txt';
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.statSync as ReturnType<typeof vi.fn>).mockReturnValue({
        size: 50 * 1024 * 1024, // 50MB
      } as fs.Stats);

      expect(config.shouldExcludeFile(filePath)).toBe(false);
    });

    it('should handle stat errors gracefully', () => {
      const filePath = 'error-file.txt';
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.statSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      expect(() => config.shouldExcludeFile(filePath)).not.toThrow();
      expect(config.shouldExcludeFile(filePath)).toBe(false);
    });

    it('should check parent directories for pattern matches', () => {
      expect(config.shouldExcludeFile('node_modules/lib/index.js')).toBe(true);
      expect(config.shouldExcludeFile('dist/lib/index.js')).toBe(true);
      expect(config.shouldExcludeFile('build/assets/style.css')).toBe(true);
    });
  });

  describe('update', () => {
    beforeEach(() => {
      config = new CheckpointConfig();
    });

    it('should update config and save to file', () => {
      const newConfig = {
        enabled: false,
        retention_days: 30,
      };

      config.update(newConfig);
      expect(config.enabled).toBe(false);
      expect(config.retentionDays).toBe(30);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        mockConfigPath,
        expect.stringContaining('"enabled": false')
      );
    });

    it('should preserve other config values when updating', () => {
      config.update({ enabled: false });
      expect(config.enabled).toBe(false);
      expect(config.retentionDays).toBe(7); // Unchanged
      expect(config.maxFileSizeMb).toBe(100); // Unchanged
    });
  });

  describe('reload', () => {
    it('should reload config from file', () => {
      config = new CheckpointConfig();

      // Change the mock to return different config
      const newConfig = {
        enabled: false,
        retention_days: 30,
      };
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(newConfig));

      config.reload();
      expect(config.enabled).toBe(false);
      expect(config.retentionDays).toBe(30);
    });
  });

  describe('getConfig', () => {
    it('should return a copy of the config', () => {
      config = new CheckpointConfig();
      const configCopy = config.getConfig();

      expect(configCopy).toEqual({
        enabled: true,
        retention_days: 7,
        exclude_patterns: expect.any(Array),
        max_file_size_mb: 100,
        checkpoint_on_stop: false,
        auto_cleanup: true,
      });

      // Verify it's a copy, not a reference
      configCopy.enabled = false;
      expect(config.enabled).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should use default config on read error', () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Read error');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      config = new CheckpointConfig();

      expect(config.enabled).toBe(true); // Default value
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error loading config'));
      consoleSpy.mockRestore();
    });

    it('should handle save errors gracefully', () => {
      (fs.writeFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Write error');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      config = new CheckpointConfig();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error saving config'));
      consoleSpy.mockRestore();
    });

    it('should handle JSON parse errors', () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('invalid json');

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      config = new CheckpointConfig();

      expect(config.enabled).toBe(true); // Default value
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
