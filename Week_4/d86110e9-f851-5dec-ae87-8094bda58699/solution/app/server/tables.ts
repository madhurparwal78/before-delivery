import type { Queryable } from './db.js';
import { parseDecimal } from './conditions.js';
import { stringify } from './template.js';
import type { Json, JsonObject } from './json.js';

export interface Column {
  name: string;
  type: 'text' | 'number';
}

interface TableRow {
  id: string;
  workspace_id: string;
  name: string;
  columns: Column[];
}

export class NumberColumnError extends Error {
  constructor(readonly column: string) {
    super(column);
  }
}

export async function findTable(client: Queryable, workspaceId: string, tableId: string): Promise<TableRow | null> {
  const { rows } = await client.query<TableRow>('SELECT id, workspace_id, name, columns FROM data_tables WHERE id = $1 AND workspace_id = $2', [tableId, workspaceId]);
  return rows[0] ?? null;
}

function emptyRow(columns: Column[]): JsonObject {
  return Object.fromEntries(columns.map((column) => [column.name, column.type === 'number' ? null : '']));
}

/** A number column takes a number or text that is a plain decimal; a text column takes the value as text. */
function coerce(column: Column, value: Json): Json {
  if (column.type === 'text') return stringify(value);
  const number = typeof value === 'number' ? value : typeof value === 'string' ? parseDecimal(value) : null;
  if (number === null || !Number.isFinite(number)) throw new NumberColumnError(column.name);
  return number;
}

/** The cells a write sets: listed columns that exist, coerced; others are ignored. */
function coerceCells(columns: Column[], values: Record<string, Json>): JsonObject {
  const cells: JsonObject = {};
  for (const column of columns) {
    if (Object.hasOwn(values, column.name)) cells[column.name] = coerce(column, values[column.name] ?? null);
  }
  return cells;
}

export async function insertRow(client: Queryable, table: TableRow, values: Record<string, Json>): Promise<JsonObject> {
  const cells = { ...emptyRow(table.columns), ...coerceCells(table.columns, values) };
  const { rows } = await client.query<{ row_seq: number }>('UPDATE data_tables SET row_seq = row_seq + 1 WHERE id = $1 RETURNING row_seq', [table.id]);
  const seq = rows[0]?.row_seq ?? 1;
  await client.query('INSERT INTO table_rows (table_id, row_id, seq, cells) VALUES ($1, $2, $3, $4)', [table.id, `r${seq}`, seq, JSON.stringify(cells)]);
  return { _row_id: `r${seq}`, ...cells };
}

export async function updateRow(client: Queryable, table: TableRow, rowId: string, values: Record<string, Json>): Promise<JsonObject | null> {
  const { rows } = await client.query<{ cells: JsonObject }>('SELECT cells FROM table_rows WHERE table_id = $1 AND row_id = $2 FOR UPDATE', [table.id, rowId]);
  const current = rows[0];
  if (current === undefined) return null;
  const cells = { ...current.cells, ...coerceCells(table.columns, values) };
  await client.query('UPDATE table_rows SET cells = $3 WHERE table_id = $1 AND row_id = $2', [table.id, rowId, JSON.stringify(cells)]);
  return { _row_id: rowId, ...cells };
}

export async function listRows(client: Queryable, tableId: string): Promise<JsonObject[]> {
  const { rows } = await client.query<{ row_id: string; cells: JsonObject }>('SELECT row_id, cells FROM table_rows WHERE table_id = $1 ORDER BY seq', [tableId]);
  return rows.map((row) => ({ _row_id: row.row_id, ...row.cells }));
}
