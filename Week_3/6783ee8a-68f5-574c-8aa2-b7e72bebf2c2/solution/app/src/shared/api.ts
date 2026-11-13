/** The shapes both the server and the page use. Field names are the API's own (snake_case). */

export type CellType = "code" | "markdown";
export type RunState = "idle" | "queued" | "running" | "finished" | "failed" | "interrupted" | "not_run";
export type KernelStatus = "starting" | "idle" | "busy" | "interrupted" | "restarting";
export type Role = "owner" | "editor" | "viewer";
export type ShareRole = "editor" | "viewer";
export type RunResultStatus = "finished" | "failed" | "interrupted" | "not_run" | "cancelled";

export interface StreamOutput {
  output_type: "stream";
  name: "stdout" | "stderr";
  text: string | string[];
}
export interface ExecuteResultOutput {
  output_type: "execute_result";
  execution_count: number | null;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
}
export interface DisplayDataOutput {
  output_type: "display_data";
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
}
export interface ErrorOutput {
  output_type: "error";
  ename: string;
  evalue: string;
  traceback: string[];
}
export type Output = StreamOutput | ExecuteResultOutput | DisplayDataOutput | ErrorOutput;

export const TABLE_MIME = "application/vnd.brackenpad.table+json";

export interface TableData {
  columns: string[];
  rows: unknown[][];
}

export interface Cell {
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

export interface Checkpoint {
  id: string;
  number: number;
  label: string;
  created_at: string;
  status: "saved";
}

export interface User {
  id: string;
  email: string;
  display_name: string;
  verified: boolean;
}

export interface Present {
  tab_id: string;
  user_id: string;
  display_name: string;
  cell_id: string | null;
}

export interface Share {
  id: string;
  email: string;
  display_name: string | null;
  role: ShareRole;
  status: "invited" | "active";
}

export interface NotebookListItem {
  id: string;
  title: string;
  role: Role;
  owner_display_name: string;
  modified_at: string;
}

export interface AppConfig {
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

export interface FieldError {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  errors?: FieldError[];
  cells?: Cell[];
  cell_id?: string;
  holder?: string;
  version?: number;
  from?: string;
  to?: string;
}

export type CompareTag = "Unchanged" | "Modified" | "Added" | "Removed" | "Moved";

export interface DiffLine {
  op: "same" | "removed" | "added";
  line: string;
}

export interface CompareRow {
  tag: CompareTag;
  checkpoint_cell: Cell | null;
  current_cell: Cell | null;
  source_diff: DiffLine[];
  output_changed: boolean;
}

export interface CompareResult {
  counts: { modified: number; added: number; removed: number; moved: number };
  rows: CompareRow[];
}

export interface InvitationInfo {
  email: string;
  role: ShareRole;
  notebook_title: string;
  owner_display_name: string;
  account_exists: boolean;
}

/** Server-sent events a notebook page listens to. */
export type LiveEvent =
  | { type: "ready" }
  | { type: "cells"; order?: string[]; cells: Cell[] }
  | { type: "result"; cell_id: string; status: RunResultStatus; execution_count: number | null; ename: string | null }
  | { type: "kernel"; kernel_status: KernelStatus }
  | { type: "presence"; present: Present[] }
  | { type: "checkpoints" }
  | { type: "access_revoked" };

export const cleanSeconds = (milliseconds: number): string =>
  (milliseconds / 1000).toFixed(6).replace(/\.?0+$/, "");

export const withCommas = (value: number): string => value.toLocaleString("en-US");
