# Claude Code Checkpointing Hook (TypeScript)

Automatic git-based checkpointing system for Claude Code that creates snapshots before file modifications.

## Features

- **Automatic Checkpoints**: Created before Write, Edit, and MultiEdit operations
- **Shadow Repositories**: Uses separate git repos to avoid cluttering your project
- **Easy Restoration**: Interactive restore with diff preview
- **Efficient Storage**: Uses git's delta compression
- **Configurable**: Retention periods, exclude patterns, size limits
- **TypeScript**: Fully typed with comprehensive test coverage

## Installation

```bash
# Clone the repository
git clone https://github.com/mkusaka/ccheck.git
cd ccheck

# Install dependencies
pnpm install

# Build the project
pnpm run build

# Install the hook
pnpm run install-hook
```

## Usage

```bash
# List checkpoints
ckpt list

# Show configuration
ckpt config

# Run tests
pnpm test

# Run tests with coverage
pnpm run test:coverage
```

## Development

```bash
# Install dependencies
pnpm install

# Build TypeScript
pnpm run build

# Watch mode
pnpm run watch

# Run tests
pnpm test

# Run tests with UI
pnpm run test:ui

# Format code
pnpm run format

# Lint code
pnpm run lint

# Type check
pnpm tsc --noEmit
```

## Configuration

The checkpointing hook stores its configuration in `~/.claude/hooks/ixe1/claude-code-checkpointing-hook/config.json`:

```json
{
  "enabled": true,
  "retention_days": 7,
  "exclude_patterns": [
    "*.log",
    "node_modules/",
    ".env",
    "__pycache__/",
    "*.tmp",
    ".git/",
    "dist/",
    "build/",
    "coverage/"
  ],
  "max_file_size_mb": 100,
  "checkpoint_on_stop": false,
  "auto_cleanup": true
}
```

## CI/CD

This project uses GitHub Actions for continuous integration. The CI pipeline:

- Runs on Node.js 18.x and 20.x
- Checks code formatting with Prettier
- Lints code with oxlint
- Type checks with TypeScript
- Runs all tests with Vitest
- Generates and uploads test coverage

## License

MIT