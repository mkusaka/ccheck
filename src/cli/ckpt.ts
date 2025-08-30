#!/usr/bin/env node
/**
 * Command-line interface for checkpoint management
 */

import { program } from 'commander';
// import { spawn } from 'child_process';
import chalk from 'chalk';
// import path from 'path';
// import { fileURLToPath } from 'url';
import { GitCheckpointManager } from '../lib/git-ops';
import { CheckpointConfig } from '../lib/config';

// const __filename = fileURLToPath(import.meta.url);

// Define version
const VERSION = '1.0.0';

program.name('ckpt').description('Claude Code Checkpointing Tool').version(VERSION);

// List command
program
  .command('list')
  .alias('l')
  .description('List all checkpoints')
  .option('-n, --limit <number>', 'Limit number of checkpoints shown', '20')
  .action(async (options) => {
    const projectPath = process.cwd();
    const checkpointMgr = new GitCheckpointManager(projectPath);
    const checkpoints = await checkpointMgr.listCheckpoints();

    if (checkpoints.length === 0) {
      console.log(chalk.yellow('No checkpoints found for this project.'));
      return;
    }

    console.log(chalk.blue('\n📚 Checkpoints'));
    console.log(chalk.gray(`Project: ${projectPath}\n`));

    const limit = parseInt(options.limit) || 20;
    const toShow = checkpoints.slice(0, limit);

    for (const cp of toShow) {
      const date = new Date(cp.timestamp);
      const timeStr = date.toLocaleString();
      const hashStr = cp.hash.substring(0, 8);
      const toolStr = cp.metadata?.tool_name || 'Unknown';

      console.log(`${chalk.cyan(hashStr)} - ${cp.message} (${toolStr})`);
      console.log(chalk.gray(`  ${timeStr}`));
      console.log();
    }

    if (checkpoints.length > limit) {
      console.log(
        chalk.gray(`Showing ${limit} of ${checkpoints.length} checkpoints. Use -n to show more.`)
      );
    }
  });

// Config command
program
  .command('config')
  .description('Show current configuration')
  .action(() => {
    const config = new CheckpointConfig();

    console.log(chalk.blue('\n⚙️  Configuration'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`Enabled: ${config.enabled ? chalk.green('Yes') : chalk.red('No')}`);
    console.log(`Retention Days: ${chalk.cyan(config.retentionDays.toString())}`);
    console.log(`Max File Size: ${chalk.cyan(config.maxFileSizeMb + ' MB')}`);
    console.log(`Auto Cleanup: ${config.autoCleanup ? chalk.green('Yes') : chalk.red('No')}`);
    console.log(
      `Checkpoint on Stop: ${config.checkpointOnStop ? chalk.green('Yes') : chalk.red('No')}`
    );

    console.log('\nExclude Patterns:');
    for (const pattern of config.excludePatterns) {
      console.log(chalk.gray(`  • ${pattern}`));
    }
  });

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
