// The API's shapes as the browser sees them, and plain JSON requests.

export type Kind = "decimal" | "text" | "date" | "bool" | "reference" | "error" | "blank";
type ColumnType = "text" | "decimal" | "date" | "bool" | "reference" | "formula";
export type Role = "owner" | "editor" | "viewer";

export interface Cell {
  value: string | boolean | null;
  display: string;
  kind: Kind;
  revision: number | null;
}

export interface Column {
  id: string;
  name: string;
  type: ColumnType;
  formula: string | null;
  target_table_id: string | null;
  position: number;
  revision: number;
}

export interface Row {
  id: string;
  revision: number | null;
  cells: Record<string, Cell>;
}

export interface TableData {
  id: string;
  name: string;
  kind: "table" | "summary";
  revision: number;
  owner_column_id: string | null;
  columns: Column[];
  rows: Row[];
}

export interface TableInfo {
  id: string;
  name: string;
  kind: "table" | "summary";
  revision: number;
  row_count: number;
  column_count: number;
  source_table_id: string | null;
}

export interface Access {
  role: Role;
  row_scope: "all" | "own";
}

export interface Stacks {
  undo_count: number;
  redo_count: number;
}

interface RecalcCell {
  table_id: string;
  row_id: string;
  column_id: string;
  old_display: string | null;
  new_display: string | null;
  new_kind: Kind | null;
  depth: number;
}

export interface Recalc {
  cells: RecalcCell[];
  count: number;
  tables: number;
  sentence: string;
  row_counts: Record<string, number>;
  column_counts: Record<string, number>;
  stacks: Stacks;
  access: Access;
  document_revision: number;
}

export interface DocumentRead {
  document: { id: string; name: string; role: Role; row_scope: "all" | "own"; revision: number; undo_count: number; redo_count: number };
  tables: TableInfo[];
}

export interface TableRead {
  table: TableData;
  access: Access;
  stacks: Stacks;
  document_revision: number;
}

export interface ExportRec {
  id: string;
  table_id: string;
  file_name: string;
  status: "writing" | "ready" | "failed";
  download_url: string | null;
}

export interface Share {
  id: string;
  email: string;
  role: "editor" | "viewer";
  row_scope: "all" | "own";
  invite_status: "sent" | "not_sent";
}

export interface ApiErrorBody {
  code: string;
  message: string;
  fields?: Record<string, string>;
  current?: { value?: Cell["value"]; display?: string; revision?: number; row?: Row; column?: Column; table?: { id: string; name: string; revision: number } };
  conflicts?: { row_id: string; column_id: string; current: { value: Cell["value"]; display: string; revision: number } }[];
  stacks?: Stacks;
}

type Answer<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiErrorBody | null };

export async function request<T>(method: string, url: string, body?: unknown): Promise<Answer<T>> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  return readAnswer<T>(response);
}

// An answer's JSON body: the data on success, the error object otherwise.
export async function readAnswer<T>(response: Response): Promise<Answer<T>> {
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : null;
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  return { ok: false, status: response.status, error: (parsed as { error?: ApiErrorBody } | null)?.error ?? null };
}

export const docPath = (docId: string) => `/api/documents/${encodeURIComponent(docId)}`;
export const tablePath = (docId: string, tableId: string) => `${docPath(docId)}/tables/${encodeURIComponent(tableId)}`;

export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `tf-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
