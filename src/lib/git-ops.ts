import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import fse from 'fs-extra';
import path from 'path';
import os from 'os';
import { logger } from './logger';
import { CheckpointMetadata } from './metadata';
import type { GitResult, Checkpoint } from '../types';

const execAsync = promisify(exec);

export class GitCheckpointManager {
  readonly projectPath: string;
  readonly checkpointBase: string;
  readonly projectHash: string;
  readonly checkpointRepo: string;

  constructor(projectPath: string, checkpointBase?: string) {
    this.projectPath = path.resolve(projectPath);
    const hookDir = path.join(
      os.homedir(),
      '.claude',
      'hooks',
      'ixe1',
      'claude-code-checkpointing-hook'
    );
    this.checkpointBase = checkpointBase || path.join(hookDir, 'checkpoints');
    this.projectHash = this.getProjectHash();
    this.checkpointRepo = path.join(this.checkpointBase, this.projectHash);
  }

  private getProjectHash(): string {
    const hash = crypto.createHash('sha256');
    hash.update(this.projectPath);
    return hash.digest('hex').substring(0, 12);
  }

  private validateCheckpointHash(checkpointHash: string): boolean {
    if (!checkpointHash) {
      return false;
    }
    // Git commit hash should be 40 hex characters (or prefix)
    return /^[a-f0-9]{1,40}$/i.test(checkpointHash);
  }

  private validateMetadataSize(metadata: Record<string, any>): boolean {
    const jsonStr = JSON.stringify(metadata);
    // Limit metadata to 1MB
    return Buffer.byteLength(jsonStr, 'utf8') <= 1024 * 1024;
  }

  async runGit(
    args: string[],
    options: { cwd?: string; timeout?: number } = {}
  ): Promise<GitResult> {
    const cwd = options.cwd || this.projectPath;
    const timeout = options.timeout || 30000;

    try {
      const cmd = `git ${args.join(' ')}`;
      const result = await execAsync(cmd, {
        cwd: cwd.toString(),
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      return {
        returncode: 0,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error: any) {
      return {
        returncode: error.code || 1,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
      };
    }
  }

  runGitSync(args: string[], options: { cwd?: string } = {}): GitResult {
    const cwd = options.cwd || this.projectPath;

    try {
      const cmd = `git ${args.join(' ')}`;
      const result = execSync(cmd, {
        cwd: cwd.toString(),
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      return {
        returncode: 0,
        stdout: result,
        stderr: '',
      };
    } catch (error: any) {
      return {
        returncode: error.status || 1,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
      };
    }
  }

  async isGitRepo(): Promise<boolean> {
    const result = await this.runGit(['rev-parse', '--git-dir']);
    return result.returncode === 0;
  }

  async initProjectRepo(): Promise<boolean> {
    if (await this.isGitRepo()) {
      return true;
    }

    const result = await this.runGit(['init']);
    if (result.returncode !== 0) {
      return false;
    }

    // Create initial commit
    await this.runGit(['add', '-A']);
    await this.runGit(['commit', '-m', 'Initial checkpoint commit']);
    return true;
  }

  async initCheckpointRepo(): Promise<boolean> {
    if (await fse.pathExists(this.checkpointRepo)) {
      return true;
    }

    try {
      await fse.ensureDir(this.checkpointRepo);

      // Initialize as a bare repository
      const result = await this.runGit(['init', '--bare'], { cwd: this.checkpointRepo });
      if (result.returncode !== 0) {
        return false;
      }

      // Set up the worktree
      const worktreePath = path.join(this.checkpointRepo, 'worktree');
      if (!(await fse.pathExists(worktreePath))) {
        // Clone the project repo into the checkpoint worktree
        if (await this.isGitRepo()) {
          await this.runGit(['clone', this.projectPath, worktreePath]);
        } else {
          // If not a git repo, create a new one
          await fse.ensureDir(worktreePath);
          await this.runGit(['init'], { cwd: worktreePath });
        }
      }

      return true;
    } catch (error) {
      logger.error(`Failed to init checkpoint repo: ${(error as Error).message}`);
      return false;
    }
  }

  async createCheckpoint(message: string, metadata: Record<string, any>): Promise<string | null> {
    if (!(await this.initCheckpointRepo())) {
      return null;
    }

    // Validate metadata size
    if (!this.validateMetadataSize(metadata)) {
      logger.warning('Metadata too large, truncating');
      // Truncate metadata to essential fields only
      metadata = {
        tool_name: metadata.tool_name || '',
        session_id: metadata.session_id || '',
        files: (metadata.files || []).slice(0, 10), // Limit files list
      };
    }

    const worktreePath = path.join(this.checkpointRepo, 'worktree');

    try {
      // Sync project files to worktree
      await this.syncFiles(this.projectPath, worktreePath);

      // Create checkpoint commit
      await this.runGit(['add', '-A'], { cwd: worktreePath });

      const timestamp = new Date().toISOString();
      const commitMessage = `CHECKPOINT: ${message} [${timestamp}]`;

      const result = await this.runGit(['commit', '-m', commitMessage, '--allow-empty'], {
        cwd: worktreePath,
      });

      if (result.returncode !== 0) {
        return null;
      }

      // Get commit hash
      const hashResult = await this.runGit(['rev-parse', 'HEAD'], { cwd: worktreePath });
      if (hashResult.returncode !== 0) {
        return null;
      }

      const commitHash = hashResult.stdout.trim();

      // Add metadata as git note
      const metadataJson = JSON.stringify(metadata, null, 2);
      await this.runGit(['notes', 'add', '-m', metadataJson, commitHash], { cwd: worktreePath });

      // Ensure we're back on main branch for future checkpoints
      await this.runGit(['checkout', 'main'], { cwd: worktreePath });

      return commitHash;
    } catch (error) {
      logger.error(`Failed to create checkpoint: ${(error as Error).message}`);
      return null;
    }
  }

  private async syncFiles(src: string, dst: string): Promise<void> {
    // Read .gitignore if present
    const gitignorePath = path.join(src, '.gitignore');
    let gitignorePatterns: string[] = [];
    if (await fse.pathExists(gitignorePath)) {
      const content = await fse.readFile(gitignorePath, 'utf8');
      gitignorePatterns = content.split('\n').filter((line) => line && !line.startsWith('#'));
    }

    // Copy all files
    await fse.copy(src, dst, {
      overwrite: true,
      filter: (srcPath) => {
        const relativePath = path.relative(src, srcPath);

        // Skip hidden files except .gitignore
        if (path.basename(srcPath).startsWith('.') && path.basename(srcPath) !== '.gitignore') {
          return false;
        }

        // Skip gitignored patterns
        for (const pattern of gitignorePatterns) {
          if (pattern && relativePath.includes(pattern.trim())) {
            return false;
          }
        }

        return true;
      },
    });
  }

  async listCheckpoints(): Promise<Checkpoint[]> {
    if (!(await fse.pathExists(this.checkpointRepo))) {
      return [];
    }

    const worktreePath = path.join(this.checkpointRepo, 'worktree');

    // Import metadata manager
    const metadataMgr = new CheckpointMetadata();

    // Get checkpoints from metadata
    const projectCheckpoints = await metadataMgr.listProjectCheckpoints(this.projectHash);

    const checkpoints: Checkpoint[] = [];
    for (const cp of projectCheckpoints) {
      // Get git commit info to verify it exists
      const result = await this.runGit(['rev-parse', cp.hash], { cwd: worktreePath });

      if (result.returncode === 0) {
        // Get commit message
        const msgResult = await this.runGit(['log', '-1', '--pretty=format:%s', cp.hash], {
          cwd: worktreePath,
        });

        let message = msgResult.returncode === 0 ? msgResult.stdout.trim() : 'Unknown';
        // Clean up message
        if (message.includes('CHECKPOINT:')) {
          message = message.replace('CHECKPOINT: ', '');
          const bracketIndex = message.indexOf('[');
          if (bracketIndex !== -1) {
            message = message.substring(0, bracketIndex).trim();
          }
        }

        checkpoints.push({
          hash: cp.hash,
          timestamp: cp.timestamp || '',
          message,
          metadata: {
            tool_name: cp.tool_name || '',
            session_id: cp.session_id || '',
            files_affected: cp.files_affected || [],
          },
        });
      }
    }

    return checkpoints;
  }

  async restoreCheckpoint(checkpointHash: string, dryRun = false): Promise<boolean> {
    if (!(await fse.pathExists(this.checkpointRepo))) {
      return false;
    }

    // Validate checkpoint hash
    if (!this.validateCheckpointHash(checkpointHash)) {
      console.error(`Error: Invalid checkpoint hash format: ${checkpointHash}`);
      logger.error(`Invalid checkpoint hash format: ${checkpointHash}`);
      return false;
    }

    const worktreePath = path.join(this.checkpointRepo, 'worktree');

    // First, checkout the checkpoint in the worktree
    const result = await this.runGit(['checkout', checkpointHash], { cwd: worktreePath });
    if (result.returncode !== 0) {
      console.error(`Error: Failed to checkout checkpoint: ${result.stderr}`);
      logger.error(`Failed to checkout checkpoint: ${result.stderr}`);
      return false;
    }

    if (dryRun) {
      // Show what would be changed
      console.log(`Would restore to checkpoint ${checkpointHash}`);
      return true;
    }

    // Copy files back to project
    try {
      await this.syncFiles(worktreePath, this.projectPath);

      // Switch back to main branch for future operations
      await this.runGit(['checkout', 'main'], { cwd: worktreePath });

      return true;
    } catch (error) {
      logger.error(`Restoration failed: ${(error as Error).message}`);
      return false;
    }
  }

  async getCheckpointDiff(checkpointHash?: string): Promise<string> {
    if (!(await fse.pathExists(this.checkpointRepo))) {
      return '';
    }

    // Validate checkpoint hash if provided
    if (checkpointHash && !this.validateCheckpointHash(checkpointHash)) {
      return `Error: Invalid checkpoint hash format: ${checkpointHash}`;
    }

    const worktreePath = path.join(this.checkpointRepo, 'worktree');

    // Update worktree with current state
    await this.syncFiles(this.projectPath, worktreePath);

    let result: GitResult;
    if (checkpointHash) {
      result = await this.runGit(['diff', checkpointHash, '--stat'], { cwd: worktreePath });
    } else {
      // Diff against last checkpoint
      result = await this.runGit(['diff', 'HEAD', '--stat'], { cwd: worktreePath });
    }

    return result.returncode === 0 ? result.stdout : '';
  }
}
