#!/usr/bin/env node
/**
 * Main checkpoint manager script for Claude Code hooks.
 * This script is called by PreToolUse and PostToolUse hooks.
 */

import process from 'process';
import path from 'path';
import { CheckpointConfig } from './lib/config';
import { GitCheckpointManager } from './lib/git-ops';
import { CheckpointMetadata } from './lib/metadata';
import { logger } from './lib/logger';
import type { HookInput } from './types';

async function handlePreToolUse(inputData: HookInput): Promise<number> {
  // Load configuration
  const config = new CheckpointConfig();

  if (!config.enabled) {
    return 0;
  }

  // Extract hook data
  const toolName = inputData.tool_name || '';
  const toolInput = inputData.tool_input || {};
  const sessionId = inputData.session_id || '';

  // Only checkpoint for file modification tools and manual checkpoints
  if (!['Write', 'Edit', 'MultiEdit', 'Manual'].includes(toolName)) {
    return 0;
  }

  // Get project path (current working directory)
  const projectPath = process.cwd();

  // Check if we should skip this file
  if (toolInput.file_path) {
    const filePath = path.resolve(toolInput.file_path);
    if (config.shouldExcludeFile(filePath)) {
      console.error(`Skipping checkpoint for excluded file: ${filePath}`);
      logger.info(`Skipping checkpoint for excluded file: ${filePath}`);
      return 0;
    }
  }

  // Initialize checkpoint manager
  const checkpointMgr = new GitCheckpointManager(projectPath);

  // Initialize project repo if needed
  if (!(await checkpointMgr.isGitRepo())) {
    if (!(await checkpointMgr.initProjectRepo())) {
      logger.warning('Could not initialize git repository');
      // Continue anyway - don't block the operation
      return 0;
    }
  }

  // Create checkpoint with descriptive message
  let message: string;
  if (toolName === 'Write') {
    if (toolInput.file_path) {
      const filename = path.basename(toolInput.file_path);
      message = `Before creating ${filename}`;
    } else {
      message = 'Before creating new file';
    }
  } else if (toolName === 'Edit') {
    if (toolInput.file_path) {
      const filename = path.basename(toolInput.file_path);
      message = `Before editing ${filename}`;
    } else {
      message = 'Before editing file';
    }
  } else if (toolName === 'MultiEdit') {
    if (toolInput.file_path) {
      const filename = path.basename(toolInput.file_path);
      const editCount = (toolInput.edits || []).length;
      message = `Before ${editCount} edits to ${filename}`;
    } else {
      message = 'Before multi-edit operation';
    }
  } else if (toolName === 'Manual') {
    // For manual checkpoints, use the message from tool_input if provided
    message = toolInput.message || 'Manual checkpoint';
  } else {
    message = `Before ${toolName} operation`;
  }

  const metadata = {
    tool_name: toolName,
    session_id: sessionId,
    files: toolInput.file_path ? [toolInput.file_path] : [],
  };

  const checkpointHash = await checkpointMgr.createCheckpoint(message, metadata);

  if (checkpointHash) {
    // Store metadata
    const metadataMgr = new CheckpointMetadata();
    await metadataMgr.addCheckpoint(
      checkpointMgr.projectHash,
      checkpointHash,
      toolName,
      toolInput,
      sessionId
    );

    console.error(`Created checkpoint: ${checkpointHash.substring(0, 8)}`);
    logger.info(`Created checkpoint: ${checkpointHash.substring(0, 8)}`);
    return 0;
  } else {
    console.error('Warning: Could not create checkpoint');
    logger.warning('Could not create checkpoint');
    // Don't block the operation
    return 0;
  }
}

async function handlePostToolUse(inputData: HookInput): Promise<number> {
  // Load configuration
  const config = new CheckpointConfig();

  if (!config.enabled) {
    return 0;
  }

  // Extract hook data
  const toolName = inputData.tool_name || '';
  const toolResponse = inputData.tool_response || {};

  // Only process for file modification tools
  if (!['Write', 'Edit', 'MultiEdit'].includes(toolName)) {
    return 0;
  }

  // Get project path
  const projectPath = process.cwd();
  const checkpointMgr = new GitCheckpointManager(projectPath);

  // Update checkpoint status
  const metadataMgr = new CheckpointMetadata();

  // Get the latest checkpoint for this project
  const checkpoints = await metadataMgr.listProjectCheckpoints(checkpointMgr.projectHash);
  if (checkpoints.length > 0) {
    const latestCheckpoint = checkpoints[0];

    // Determine status based on tool response
    const status = toolResponse.success !== false ? 'success' : 'failed';

    await metadataMgr.updateCheckpointStatus(
      checkpointMgr.projectHash,
      latestCheckpoint.hash,
      status,
      toolResponse
    );
  }

  return 0;
}

async function showStatus(): Promise<void> {
  // Show checkpoint status for the current project
  const projectPath = process.cwd();
  const checkpointMgr = new GitCheckpointManager(projectPath);
  const metadataMgr = new CheckpointMetadata();

  const stats = await metadataMgr.getProjectStats(checkpointMgr.projectHash);

  console.log(`Checkpoint Status for: ${projectPath}`);
  console.log(`Project Hash: ${checkpointMgr.projectHash}`);
  console.log('-'.repeat(50));
  console.log(`Total Checkpoints: ${stats.total_checkpoints}`);
  console.log(`Successful: ${stats.successful}`);
  console.log(`Failed: ${stats.failed}`);
  console.log(`Pending: ${stats.pending}`);

  if (stats.latest_checkpoint) {
    console.log(`Latest Checkpoint: ${stats.latest_checkpoint}`);
  }

  if (stats.most_modified_files && stats.most_modified_files.length > 0) {
    console.log('\nMost Modified Files:');
    for (const [file, count] of stats.most_modified_files) {
      console.log(`  ${file}: ${count} times`);
    }
  }
}

async function main(): Promise<number> {
  // Parse command line arguments
  const args = process.argv.slice(2);

  if (args.includes('--status')) {
    await showStatus();
    return 0;
  }

  // Read hook input from stdin
  let inputData = '';

  process.stdin.setEncoding('utf8');

  for await (const chunk of process.stdin) {
    inputData += chunk;
  }

  try {
    const parsedData: HookInput = JSON.parse(inputData);

    // Determine if this is pre or post tool use
    if (args.includes('--update-status') || parsedData.tool_response) {
      return await handlePostToolUse(parsedData);
    } else {
      return await handlePreToolUse(parsedData);
    }
  } catch (error) {
    console.error(`Error: Invalid JSON input: ${(error as Error).message}`);
    return 1;
  }
}

// Run main function and exit with appropriate code
if (require.main === module) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((error) => {
      console.error(`Fatal error: ${error.message}`);
      process.exit(1);
    });
}
