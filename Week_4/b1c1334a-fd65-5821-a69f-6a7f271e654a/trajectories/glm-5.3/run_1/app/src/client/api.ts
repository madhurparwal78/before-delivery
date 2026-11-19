/** The client's API layer: one fetch wrapper and the API's error shape. */

export interface ApiErrorShape {
  code: string;
  message: string;
  fields?: Record<string, string>;
  current?: unknown;
  conflicts?: { row_id: string; column_id: string; current: unknown }[];
  stacks?: { undo_count: number; redo_count: number };
}

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly error: ApiErrorShape, readonly replayed: boolean) {
    super(error.message);
  }
}

export interface RecalcCell {
  table_id: string;
  row_id: string;
  column_id: string;
  old_display: string | null;
  new_display: string | null;
  new_kind: string | null;
  depth: number;
}

export interface Recalc {
  cells: RecalcCell[];
  count: number;
  tables: number;
  sentence: string;
  row_counts: Record<string, number>;
  column_counts: Record<string, number>;
  stacks: { undo_count: number; redo_count: number };
  access: { role: string; row_scope: string };
  document_revision: number;
}

export interface Cell {
  value: unknown;
  display: string;
  kind: 'decimal' | 'text' | 'date' | 'bool' | 'reference' | 'error' | 'blank';
  revision: number | null;
}

export interface Row {
  id: string;
  revision: number | null;
  cells: Record<string, Cell>;
}

export interface Column {
  id: string;
  name: string;
  type: 'text' | 'decimal' | 'date' | 'bool' | 'reference' | 'formula';
  formula: string | null;
  target_table_id: string | null;
  position: number;
  revision: number;
}

export interface TableRead {
  id: string;
  name: string;
  kind: string;
  revision: number;
  owner_column_id: string | null;
  columns: Column[];
  rows: Row[];
}

export interface TableSummary {
  id: string;
  name: string;
  kind: string;
  revision: number;
  row_count: number;
  column_count: number;
  source_table_id: string | null;
}

export interface DocumentRead {
  document: {
    id: string;
    name: string;
    role: string;
    row_scope: string;
    revision: number;
    undo_count: number;
    redo_count: number;
  };
  tables: TableSummary[];
}

export interface ExportRecord {
  id: string;
  table_id: string;
  file_name: string;
  status: 'writing' | 'ready' | 'failed';
  byte_size: number | null;
  sha256: string | null;
  download_url: string | null;
  created_by: string;
  document_revision: number;
  created_at: string;
}

export interface ShareRecord {
  id: string;
  email: string;
  role: string;
  row_scope: string;
  invite_status: string;
}

let idCounter = 0;
export const newKey = (): string => {
  idCounter += 1;
  const stamp = Date.now().toString(36);
  return `c${stamp}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
};

export type ResponseMark = { replayed?: boolean };

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: { idempotencyKey?: string } = {},
): Promise<{ data: T; replayed: boolean }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const replayed = res.headers.get('Idempotent-Replayed') === 'true';
  if (res.status === 204) return { data: null as T, replayed };
  const contentType = res.headers.get('Content-Type') ?? '';
  if (contentType.includes('json')) {
    const parsed = (await res.json()) as T & { error?: { code: string; message: string; fields?: Record<string, string>; current?: unknown; conflicts?: unknown; stacks?: unknown } };
    if (!res.ok) {
      throw new ApiFailure(res.status, parsed.error as ApiErrorShape, replayed);
    }
    return { data: parsed, replayed };
  }
  if (!res.ok) {
    throw new ApiFailure(res.status, { code: 'unknown', message: await res.text() }, replayed);
  }
  return { data: (await res.text()) as unknown as T, replayed };
}
