import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Logger } from './logger';

vi.mock('fs');
vi.mock('os', () => ({
  default: {
    homedir: vi.fn(() => '/mock/home'),
  },
  homedir: vi.fn(() => '/mock/home'),
}));

describe('Logger', () => {
  let logger: Logger;
  const mockHomedir = '/mock/home';
  const mockLogFile = path.join(
    mockHomedir,
    '.claude',
    'hooks',
    'ixe1',
    'claude-code-checkpointing-hook',
    'checkpoint.log'
  );

  beforeEach(() => {
    vi.clearAllMocks();
    (os.homedir as ReturnType<typeof vi.fn>).mockReturnValue(mockHomedir);
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (fs.mkdirSync as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);
    (fs.appendFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);
    logger = new Logger();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create log directory if it does not exist', () => {
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.dirname(mockLogFile), { recursive: true });
    });

    it('should not create log directory if it already exists', () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.mkdirSync as ReturnType<typeof vi.fn>).mockClear();
      new Logger();
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe('info', () => {
    it('should write INFO level message to log file', () => {
      const message = 'Test info message';
      logger.info(message);

      expect(fs.appendFileSync).toHaveBeenCalledWith(
        mockLogFile,
        expect.stringContaining('[INFO] Test info message')
      );
    });

    it('should include timestamp in log message', () => {
      const message = 'Test message';
      const beforeTime = new Date().toISOString();
      logger.info(message);
      const afterTime = new Date().toISOString();

      expect(fs.appendFileSync).toHaveBeenCalledWith(
        mockLogFile,
        expect.stringMatching(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/)
      );
    });
  });

  describe('warning', () => {
    it('should write WARNING level message to log file', () => {
      const message = 'Test warning message';
      logger.warning(message);

      expect(fs.appendFileSync).toHaveBeenCalledWith(
        mockLogFile,
        expect.stringContaining('[WARNING] Test warning message')
      );
    });
  });

  describe('error', () => {
    it('should write ERROR level message to log file', () => {
      const message = 'Test error message';
      logger.error(message);

      expect(fs.appendFileSync).toHaveBeenCalledWith(
        mockLogFile,
        expect.stringContaining('[ERROR] Test error message')
      );
    });
  });

  describe('debug', () => {
    it('should not write DEBUG message when DEBUG env is not set', () => {
      delete process.env.DEBUG;
      logger.debug('Test debug message');

      expect(fs.appendFileSync).not.toHaveBeenCalled();
    });

    it('should write DEBUG message when DEBUG env is set', () => {
      process.env.DEBUG = 'true';
      logger.debug('Test debug message');

      expect(fs.appendFileSync).toHaveBeenCalledWith(
        mockLogFile,
        expect.stringContaining('[DEBUG] Test debug message')
      );

      delete process.env.DEBUG;
    });
  });

  describe('log rotation', () => {
    it('should rotate log file when it exceeds max size', () => {
      const largeStats = { size: 11 * 1024 * 1024 }; // 11MB
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.statSync as ReturnType<typeof vi.fn>).mockReturnValue(largeStats as fs.Stats);
      (fs.renameSync as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);
      (fs.readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([]);

      logger.info('Test message');

      expect(fs.renameSync).toHaveBeenCalledWith(
        mockLogFile,
        expect.stringMatching(/checkpoint\.log\.\d+\.old$/)
      );
    });

    it('should keep only the last 3 backup files', () => {
      const largeStats = { size: 11 * 1024 * 1024 };
      const oldFileStats = { mtime: new Date('2023-01-01') };

      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.statSync as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(largeStats as fs.Stats)
        .mockReturnValue(oldFileStats as fs.Stats);
      (fs.renameSync as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);
      (fs.readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([
        'checkpoint.log.1.old',
        'checkpoint.log.2.old',
        'checkpoint.log.3.old',
        'checkpoint.log.4.old',
        'checkpoint.log.5.old',
      ]);
      (fs.unlinkSync as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);

      logger.info('Test message');

      expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should silently ignore logging errors', () => {
      (fs.appendFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Write error');
      });

      expect(() => logger.info('Test message')).not.toThrow();
    });

    it('should ignore rotation errors', () => {
      const largeStats = { size: 11 * 1024 * 1024 };
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.statSync as ReturnType<typeof vi.fn>).mockReturnValue(largeStats as fs.Stats);
      (fs.renameSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Rename error');
      });

      expect(() => logger.info('Test message')).not.toThrow();
    });
  });
});
