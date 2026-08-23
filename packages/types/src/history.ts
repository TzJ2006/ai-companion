export type EvidenceQuality = "full" | "degraded";

export type EvidenceDegradationReason =
  | "ambiguous-pre-manifest"
  | "binary-or-unsupported"
  | "identity-changed"
  | "legacy-event"
  | "path-escape"
  | "queue-overflow"
  | "read-error"
  | "repo-escape"
  | "size-limit"
  | "snapshot-unavailable"
  | "storage-root-redirect"
  | "symlink-target"
  | "unsupported-extension"
  | "unsupported-file-type";

export type ChangeOperation = "add" | "modify" | "delete";

export interface ChangeRecord {
  id: string;
  timestamp: string;
  file_path: string;
  function_hash: string;
  function_name: string;
  class_name: string | null;
  change_type: "add" | "modify" | "delete" | "rename";
  reason: string;
  reason_source: "context" | "llm-inferred" | "user-provided";
  old_content: string | null;
  new_content: string | null;
  start_line: number;
  end_line: number;
  test_status: "pending" | "pass" | "fail" | "skipped";
  test_file: string | null;
  error_id: string | null;
  session_id: string;
  ecl_context?: EclContext;
  event_id?: string;
  correlation_id?: string;
  operation?: ChangeOperation;
  evidence_quality?: EvidenceQuality;
  degradation_reason?: EvidenceDegradationReason;
  /** Degraded file-level records use a stable synthetic function_hash, not an AST identity. */
  file_level?: boolean;
  synthetic?: boolean;
}

export interface EclContext {
  feature: string;
  requirements?: string[];
  decisions?: string[];
  ecl_file?: string;
}


export interface ReviewSession {
  id: string;
  timestamp: string;
  trigger: "hook" | "cli";
  summary: string;
  total_changes: number;
  files_changed: string[];
  changes: ChangeRecord[];
}

export interface FileHistory {
  file_path: string;
  last_updated: string;
  total_records: number;
  functions: Record<string, FunctionHistory>;
}

export interface FunctionHistory {
  function_hash: string;
  function_name: string;
  class_name: string | null;
  records: ChangeRecord[];
  prev_hashes: string[];
}

export interface ProjectIndex {
  project_root: string;
  last_updated: string;
  total_sessions: number;
  total_changes: number;
  function_index: Record<string, FunctionIndexEntry>;
}

export interface FunctionIndexEntry {
  hash: string;
  file_path: string;
  function_name: string;
  class_name: string | null;
  last_modified: string;
  change_count: number;
  test_status: "pass" | "fail" | "pending" | "skipped";
}
