import { one, query } from './db';
import { send } from './sse';
import { isObject, parseDecimal } from './util';
import type { JsonObject, JsonValue } from '../shared/types';

export interface TableColumn {
  name: string;
  type: 'text' | 'number';
}

export interface TableRecord {
  id: string;
  workspace_id: string;
  name: string;
  cols: TableColumn[];
  row_seq: number;
}

export async function loadTable(workspaceId: string, tableId: string): Promise<TableRecord | null> {
  return one<TableRecord>('select * from data_tables where id = $1 and workspace_id = $2', [tableId, workspaceId]);
}

export async function listTables(workspaceId: string): Promise<(TableRecord & { row_count: number })[]> {
  const rows = await query<TableRecord & { row_count: string }>(
    `select t.*, (select count(*) from data_rows r where r.table_id = t.id) as row_count
       from data_tables t where t.workspace_id = $1 order by t.created_at`,
    [workspaceId],
  );
  return rows.map((row) => ({ ...row, row_count: Number(row.row_count) }));
}

export async function rowObjects(tableId: string): Promise<JsonObject[]> {
  const rows = await query<{ row_id: string; cells: JsonObject }>(
    'select row_id, cells from data_rows where table_id = $1 order by seq',
    [tableId],
  );
  return rows.map((row) => ({ ...row.cells, _row_id: row.row_id }));
}

export type RowValues = { ok: true; cells: JsonObject } | { ok: false; column: string };

/** Column values: number columns take a number or numeric text and are stored as numbers. */
export function coerceValues(columns: TableColumn[], values: JsonObject, base: JsonObject | null): RowValues {
  const cells: JsonObject = {};
  for (const column of columns) {
    if (base !== null) cells[column.name] = base[column.name] ?? (column.type === 'number' ? null : '');
    else cells[column.name] = column.type === 'number' ? null : '';
  }
  for (const [name, value] of Object.entries(values)) {
    const column = columns.find((item) => item.name === name);
    if (column === undefined) continue;
    if (column.type === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) cells[name] = value;
      else if (typeof value === 'string' && parseDecimal(value) !== null) cells[name] = parseDecimal(value);
      else return { ok: false, column: name };
    } else {
      cells[name] = typeof value === 'string' ? value : value === null ? '' : JSON.stringify(value);
    }
  }
  return { ok: true, cells };
}

export async function insertRow(table: TableRecord, cells: JsonObject): Promise<JsonObject> {
  const rowId = `r${table.row_seq + 1}`;
  await query('update data_tables set row_seq = row_seq + 1 where id = $1', [table.id]);
  table.row_seq += 1;
  await query('insert into data_rows (table_id, row_id, cells) values ($1, $2, $3)', [
    table.id,
    rowId,
    JSON.stringify(cells),
  ]);
  send({ type: 'table', workspace_id: table.workspace_id, table_id: table.id });
  return { ...cells, _row_id: rowId };
}

export async function readRow(tableId: string, rowId: string): Promise<JsonObject | null> {
  const row = await one<{ cells: JsonObject }>('select cells from data_rows where table_id = $1 and row_id = $2', [
    tableId,
    rowId,
  ]);
  return row ? row.cells : null;
}

export async function writeRow(table: TableRecord, rowId: string, cells: JsonObject): Promise<JsonObject> {
  await query('update data_rows set cells = $3 where table_id = $1 and row_id = $2', [
    table.id,
    rowId,
    JSON.stringify(cells),
  ]);
  send({ type: 'table', workspace_id: table.workspace_id, table_id: table.id });
  return { ...cells, _row_id: rowId };
}

export function valuesFromJson(value: JsonValue | undefined): JsonObject {
  return isObject(value) ? value : {};
}
