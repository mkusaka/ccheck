import fse from 'fs-extra';
import path from 'path';
import os from 'os';
import type {
  CheckpointMetadata as ICheckpointMetadata,
  CheckpointData,
  ProjectStats,
  ToolInput,
  ToolResponse,
} from '../types';

interface MetadataStore {
  [projectHash: string]: {
    [checkpointHash: string]: ICheckpointMetadata;
  };
}

export class CheckpointMetadata {
  private readonly checkpointBase: string;
  private readonly metadataFile: string;
  private readonly lockFile: string;

  constructor(checkpointBase?: string) {
    const hookDir = path.join(
      os.homedir(),
      '.claude',
      'hooks',
      'ixe1',
      'claude-code-checkpointing-hook'
    );
    this.checkpointBase = checkpointBase || path.join(hookDir, 'checkpoints');
    this.metadataFile = path.join(this.checkpointBase, 'metadata.json');
    this.lockFile = path.join(this.checkpointBase, '.metadata.lock');
  }

  private async acquireLock(maxWaitTime = 5000): Promise<void> {
    const waitInterval = 50;
    const startTime = Date.now();

    while (true) {
      try {
        // Try to create lock file exclusively
        await fse.ensureDir(this.checkpointBase);
        const fd = await fse.open(this.lockFile, 'wx');
        await fse.close(fd);
        return;
      } catch (error: any) {
        if (error.code === 'EEXIST') {
          // Lock file exists, check if it's stale
          if (Date.now() - startTime > maxWaitTime) {
            try {
              const stats = await fse.stat(this.lockFile);
              if (Date.now() - stats.mtimeMs > 10000) {
                // 10 seconds old
                await fse.unlink(this.lockFile);
                continue;
              }
            } catch (e) {
              // Ignore errors
            }
            throw new Error('Timeout waiting for metadata lock');
          }
          await new Promise((resolve) => setTimeout(resolve, waitInterval));
        } else {
          throw error;
        }
      }
    }
  }

  private async releaseLock(): Promise<void> {
    try {
      await fse.unlink(this.lockFile);
    } catch (error) {
      // Ignore errors
    }
  }

  private async loadMetadata(): Promise<MetadataStore> {
    try {
      if (await fse.pathExists(this.metadataFile)) {
        return await fse.readJson(this.metadataFile);
      }
    } catch (error) {
      console.error(`Error loading metadata: ${(error as Error).message}`);
    }
    return {};
  }

  private async saveMetadata(metadata: MetadataStore): Promise<void> {
    await fse.ensureDir(this.checkpointBase);

    // Use atomic write to prevent corruption
    const tempPath = `${this.metadataFile}.tmp`;
    await fse.writeJson(tempPath, metadata, { spaces: 2 });
    await fse.rename(tempPath, this.metadataFile);
  }

  async addCheckpoint(
    projectHash: string,
    checkpointHash: string,
    toolName: string,
    toolInput: ToolInput,
    sessionId: string
  ): Promise<ICheckpointMetadata> {
    await this.acquireLock();

    try {
      const metadata = await this.loadMetadata();

      if (!metadata[projectHash]) {
        metadata[projectHash] = {};
      }

      const checkpointData: ICheckpointMetadata = {
        timestamp: new Date().toISOString(),
        tool_name: toolName,
        tool_input: toolInput,
        session_id: sessionId,
        status: 'pending',
        files_affected: this.extractFiles(toolName, toolInput),
      };

      metadata[projectHash][checkpointHash] = checkpointData;
      await this.saveMetadata(metadata);

      return checkpointData;
    } finally {
      await this.releaseLock();
    }
  }

  async updateCheckpointStatus(
    projectHash: string,
    checkpointHash: string,
    status: 'success' | 'failed',
    toolResponse?: ToolResponse
  ): Promise<void> {
    await this.acquireLock();

    try {
      const metadata = await this.loadMetadata();

      if (metadata[projectHash] && metadata[projectHash][checkpointHash]) {
        metadata[projectHash][checkpointHash].status = status;
        metadata[projectHash][checkpointHash].status_updated = new Date().toISOString();

        if (toolResponse) {
          metadata[projectHash][checkpointHash].tool_response = toolResponse;
        }

        await this.saveMetadata(metadata);
      }
    } finally {
      await this.releaseLock();
    }
  }

  async getCheckpointMetadata(
    projectHash: string,
    checkpointHash: string
  ): Promise<ICheckpointMetadata | null> {
    const metadata = await this.loadMetadata();

    if (metadata[projectHash] && metadata[projectHash][checkpointHash]) {
      return metadata[projectHash][checkpointHash];
    }

    return null;
  }

  async listProjectCheckpoints(projectHash: string): Promise<CheckpointData[]> {
    const metadata = await this.loadMetadata();

    if (!metadata[projectHash]) {
      return [];
    }

    const checkpoints: CheckpointData[] = [];
    for (const [checkpointHash, data] of Object.entries(metadata[projectHash])) {
      checkpoints.push({ ...data, hash: checkpointHash });
    }

    // Sort by timestamp, newest first
    checkpoints.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return checkpoints;
  }

  async cleanupOldMetadata(projectHash: string, keepCount = 50): Promise<void> {
    await this.acquireLock();

    try {
      const metadata = await this.loadMetadata();

      if (!metadata[projectHash]) {
        return;
      }

      const checkpoints = Object.entries(metadata[projectHash]);
      checkpoints.sort(
        (a, b) => new Date(b[1].timestamp).getTime() - new Date(a[1].timestamp).getTime()
      );

      if (checkpoints.length > keepCount) {
        // Remove old entries
        for (const [checkpointHash] of checkpoints.slice(keepCount)) {
          delete metadata[projectHash][checkpointHash];
        }

        await this.saveMetadata(metadata);
      }
    } finally {
      await this.releaseLock();
    }
  }

  private extractFiles(toolName: string, toolInput: ToolInput): string[] {
    const files: string[] = [];

    if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') {
      if (toolInput.file_path) {
        files.push(toolInput.file_path);
      } else if (toolInput.edits) {
        // MultiEdit case
        for (const edit of toolInput.edits) {
          if (edit.file_path) {
            files.push(edit.file_path);
          }
        }
      }
    }

    return files;
  }

  async findCheckpointsByFile(projectHash: string, filePath: string): Promise<CheckpointData[]> {
    const checkpoints = await this.listProjectCheckpoints(projectHash);

    return checkpoints.filter(
      (checkpoint) => checkpoint.files_affected && checkpoint.files_affected.includes(filePath)
    );
  }

  async getProjectStats(projectHash: string): Promise<ProjectStats> {
    const checkpoints = await this.listProjectCheckpoints(projectHash);

    if (checkpoints.length === 0) {
      return {
        total_checkpoints: 0,
        successful: 0,
        failed: 0,
        pending: 0,
      };
    }

    return {
      total_checkpoints: checkpoints.length,
      successful: checkpoints.filter((c) => c.status === 'success').length,
      failed: checkpoints.filter((c) => c.status === 'failed').length,
      pending: checkpoints.filter((c) => c.status === 'pending').length,
      most_modified_files: this.getMostModifiedFiles(checkpoints),
      latest_checkpoint: checkpoints[0].timestamp,
    };
  }

  private getMostModifiedFiles(checkpoints: CheckpointData[], limit = 5): Array<[string, number]> {
    const fileCounts: Record<string, number> = {};

    for (const checkpoint of checkpoints) {
      for (const file of checkpoint.files_affected || []) {
        fileCounts[file] = (fileCounts[file] || 0) + 1;
      }
    }

    return Object.entries(fileCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
  }

  // For testing
  async _loadMetadata(): Promise<MetadataStore> {
    return this.loadMetadata();
  }

  async _saveMetadata(metadata: MetadataStore): Promise<void> {
    return this.saveMetadata(metadata);
  }
}

export const defaultMetadata = new CheckpointMetadata();
