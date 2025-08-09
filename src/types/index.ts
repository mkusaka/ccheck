export interface CheckpointConfig {
  enabled: boolean;
  retention_days: number;
  exclude_patterns: string[];
  max_file_size_mb: number;
  checkpoint_on_stop: boolean;
  auto_cleanup: boolean;
}

export interface HookInput {
  tool_name: string;
  tool_input: ToolInput;
  session_id: string;
  tool_response?: ToolResponse;
}

export interface ToolInput {
  file_path?: string;
  edits?: Edit[];
  message?: string;
  [key: string]: unknown;
}

export interface Edit {
  file_path?: string;
  old_string?: string;
  new_string?: string;
  [key: string]: unknown;
}

export interface ToolResponse {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface CheckpointMetadata {
  timestamp: string;
  tool_name: string;
  tool_input: ToolInput;
  session_id: string;
  status: 'pending' | 'success' | 'failed';
  files_affected: string[];
  status_updated?: string;
  tool_response?: ToolResponse;
}

export interface CheckpointData extends CheckpointMetadata {
  hash: string;
}

export interface Checkpoint {
  hash: string;
  timestamp: string;
  message: string;
  metadata?: Partial<CheckpointMetadata>;
}

export interface ProjectStats {
  total_checkpoints: number;
  successful: number;
  failed: number;
  pending: number;
  most_modified_files?: Array<[string, number]>;
  latest_checkpoint?: string;
}

export interface GitResult {
  returncode: number;
  stdout: string;
  stderr: string;
}

export interface CleanupResult {
  removed: number;
  kept: number;
}
