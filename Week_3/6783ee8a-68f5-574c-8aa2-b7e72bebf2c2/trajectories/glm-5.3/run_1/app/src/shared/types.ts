export type Role = "owner" | "editor" | "viewer";
export type CellType = "code" | "markdown";
export type RunState = "idle" | "queued" | "running" | "finished" | "failed" | "interrupted" | "not_run";
export type KernelStatus = "starting" | "idle" | "busy" | "interrupted" | "restarting";
export type Output =
  | { output_type: "stream"; name: "stdout" | "stderr"; text: string }
  | { output_type: "execute_result"; execution_count: number | null; data: Record<string, unknown>; metadata: Record<string, unknown> }
  | { output_type: "display_data"; data: Record<string, unknown>; metadata: Record<string, unknown> }
  | { output_type: "error"; ename: string; evalue: string; traceback: string[] };

export type Cell = {
  id: string;
  position: number;
  cell_type: CellType;
  source: string;
  revision: number;
  execution_count: number | null;
  run_state: RunState;
  outputs: Output[];
  outputs_version: number;
  metadata: Record<string, unknown>;
  locked_by: string | null;
};

export type Notebook = {
  id: string;
  title: string;
  role: Role;
  owner_display_name: string;
  imported: boolean;
  execution_counter: number;
  kernel_status: KernelStatus;
  cells: Cell[];
};

export type Checkpoint = { id: string; number: number; label: string; created_at: string; status: "saved" };

export type User = { id: string; email: string; display_name: string; verified: boolean };

export type PresenceEntry = { tab_id: string; user_id: string; display_name: string; cell_id: string | null };

export type LimitsConfig = {
  double_press_ms: number;
  exec_limit_ms: number;
  autosave_ms: number;
  output_line_cap: number;
  output_byte_cap: number;
  table_page_rows: number;
  import_max_bytes: number;
  checkpoints_kept: number;
  presence_timeout_ms: number;
};

export type Share = { id: string; email: string; display_name: string | null; role: Role; status: "invited" | "active" };

export type ErrorBody = { error: string; message: string; errors?: { path: string; message: string }[] };

export type CompareTag = "Unchanged" | "Modified" | "Added" | "Removed" | "Moved";
export type DiffOp = { op: "same" | "removed" | "added"; line: string };
export type CompareRow = {
  tag: CompareTag;
  checkpoint_cell: Cell | null;
  current_cell: Cell | null;
  source_diff: DiffOp[];
  output_changed: boolean;
};
export type CompareResult = {
  counts: { modified: number; added: number; removed: number; moved: number };
  rows: CompareRow[];
};

export type ImportFormatCell = {
  id?: string;
  cell_type?: unknown;
  source?: unknown;
  metadata?: unknown;
  execution_count?: unknown;
  outputs?: unknown;
  attachments?: unknown;
};
