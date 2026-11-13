export type CellType = 'code' | 'markdown';

export type RunState =
  | 'idle'
  | 'queued'
  | 'running'
  | 'finished'
  | 'failed'
  | 'interrupted'
  | 'not_run';

export type RunResultStatus = 'finished' | 'failed' | 'interrupted' | 'not_run' | 'cancelled';

export type KernelStatus = 'starting' | 'idle' | 'busy' | 'interrupted' | 'restarting';

export type Role = 'owner' | 'editor' | 'viewer';

export type ShareStatus = 'invited' | 'active';

/**
 * An open-format output object. Keys, order and values are kept as imported or
 * produced, so the shape stays open beyond the keys the app reads.
 */
export interface NotebookOutput {
  output_type: string;
  [key: string]: unknown;
}

export interface Cell {
  id: string;
  position: number;
  cell_type: CellType;
  source: string;
  revision: number;
  execution_count: number | null;
  run_state: RunState;
  outputs: NotebookOutput[];
  outputs_version: number;
  metadata: Record<string, unknown>;
  locked_by: string | null;
}

export interface Notebook {
  id: string;
  title: string;
  role: Role;
  owner_display_name: string;
  imported: boolean;
  execution_counter: number;
  kernel_status: KernelStatus;
  cells: Cell[];
}

export interface NotebookListEntry {
  id: string;
  title: string;
  role: Role;
  owner_display_name: string;
  modified_at: string;
}

export interface User {
  id: string;
  email: string;
  display_name: string;
  verified: boolean;
}

export interface Checkpoint {
  id: string;
  number: number;
  label: string;
  created_at: string;
  status: 'saved';
}

export interface Share {
  id: string;
  email: string;
  display_name: string | null;
  role: 'editor' | 'viewer';
  status: ShareStatus;
}

export interface PresenceEntry {
  tab_id: string;
  user_id: string;
  display_name: string;
  cell_id: string | null;
}

export interface PublishedLimits {
  double_press_ms: number;
  exec_limit_ms: number;
  autosave_ms: number;
  output_line_cap: number;
  output_byte_cap: number;
  table_page_rows: number;
  import_max_bytes: number;
  checkpoints_kept: number;
  presence_timeout_ms: number;
}

export type CompareTag = 'Unchanged' | 'Modified' | 'Added' | 'Removed' | 'Moved';

export interface DiffLine {
  op: 'same' | 'removed' | 'added';
  line: string;
}

export interface CompareRow {
  tag: CompareTag;
  checkpoint_cell: Cell | null;
  current_cell: Cell | null;
  source_diff: DiffLine[];
  output_changed: boolean;
}

export interface CompareCounts {
  modified: number;
  added: number;
  removed: number;
  moved: number;
}

export interface CompareResult {
  counts: CompareCounts;
  rows: CompareRow[];
}

export interface TableOutputData {
  columns: string[];
  rows: unknown[][];
}

export interface TableRowsPage {
  columns: string[];
  rows: unknown[][];
  offset: number;
  total: number;
  version: number;
}

export interface FieldError {
  path: string;
  message: string;
}
