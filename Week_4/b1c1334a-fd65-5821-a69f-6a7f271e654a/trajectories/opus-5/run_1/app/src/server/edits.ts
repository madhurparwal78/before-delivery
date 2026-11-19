import type { ColumnType } from '../shared/api.js';
import { newId, type Client } from './db.js';
import { cellKey } from './evaluate.js';
import type { ColumnData, DocData, TableData } from './model.js';
import { convertDisplayToType } from './validate.js';

export type CellWrite = { rowId: string; columnId: string; raw: string | null };
export type CellRevision = { rowId: string; columnId: string; revision: number };

export function displayFromRaw(type: ColumnType, raw: string | null): string {
  if (raw === null) return '';
  if (type === 'bool') return raw === 'true' ? 'TRUE' : 'FALSE';
  return raw;
}

export async function writeCells(client: Client, writes: CellWrite[]): Promise<CellRevision[]> {
  const out: CellRevision[] = [];
  for (const write of writes) {
    const result = await client.query<{ revision: number }>(
      `update doc_cells set raw = $3, revision = revision + 1
       where row_id = $1 and column_id = $2 returning revision`,
      [write.rowId, write.columnId, write.raw],
    );
    await client.query('update doc_rows set revision = revision + 1 where id = $1', [write.rowId]);
    out.push({
      rowId: write.rowId,
      columnId: write.columnId,
      revision: result.rows[0]?.revision ?? 1,
    });
  }
  return out;
}

export async function insertRow(
  client: Client,
  table: TableData,
  cells: Array<{ columnId: string; raw: string | null }>,
): Promise<string> {
  const next = await client.query<{ seq: string }>(
    'select coalesce(max(seq), 0) + 1 as seq from doc_rows where table_id = $1',
    [table.id],
  );
  const rowId = newId('row');
  await client.query(
    'insert into doc_rows (id, table_id, revision, seq) values ($1, $2, 1, $3)',
    [rowId, table.id, Number(next.rows[0]?.seq ?? 1)],
  );
  const byColumn = new Map(cells.map((cell) => [cell.columnId, cell.raw]));
  for (const column of table.columns) {
    if (column.type === 'formula') continue;
    await client.query(
      'insert into doc_cells (row_id, column_id, raw, revision) values ($1, $2, $3, 1)',
      [rowId, column.id, byColumn.get(column.id) ?? null],
    );
  }
  return rowId;
}

async function referencesTo(
  client: Client,
  documentId: string,
  rowId: string,
): Promise<Array<{ rowId: string; columnId: string }>> {
  const result = await client.query<{ row_id: string; column_id: string }>(
    `select c.row_id, c.column_id
     from doc_cells c
     join doc_columns col on col.id = c.column_id
     join doc_rows r on r.id = c.row_id
     join doc_tables t on t.id = r.table_id
     where c.raw = $1 and col.type = 'reference' and col.deleted = false
       and r.deleted = false and t.document_id = $2`,
    [rowId, documentId],
  );
  return result.rows.map((row) => ({ rowId: row.row_id, columnId: row.column_id }));
}

export async function deleteRow(
  client: Client,
  doc: DocData,
  rowId: string,
): Promise<CellRevision[]> {
  await client.query('update doc_rows set deleted = true where id = $1', [rowId]);
  const references = await referencesTo(client, doc.id, rowId);
  const bumped: CellRevision[] = [];
  for (const reference of references) {
    const result = await client.query<{ revision: number }>(
      `update doc_cells set revision = revision + 1
       where row_id = $1 and column_id = $2 returning revision`,
      [reference.rowId, reference.columnId],
    );
    await client.query('update doc_rows set revision = revision + 1 where id = $1', [
      reference.rowId,
    ]);
    bumped.push({ ...reference, revision: result.rows[0]?.revision ?? 1 });
  }
  return bumped;
}

export async function restoreRow(
  client: Client,
  rowId: string,
  references: CellRevision[],
): Promise<CellRevision[]> {
  await client.query('update doc_rows set deleted = false where id = $1', [rowId]);
  const produced: CellRevision[] = [];
  for (const reference of references) {
    const current = await client.query<{ raw: string | null; revision: number }>(
      'select raw, revision from doc_cells where row_id = $1 and column_id = $2',
      [reference.rowId, reference.columnId],
    );
    const cell = current.rows[0];
    if (cell === undefined || cell.raw !== rowId || cell.revision !== reference.revision) continue;
    const updated = await client.query<{ revision: number }>(
      `update doc_cells set revision = revision + 1
       where row_id = $1 and column_id = $2 returning revision`,
      [reference.rowId, reference.columnId],
    );
    await client.query('update doc_rows set revision = revision + 1 where id = $1', [
      reference.rowId,
    ]);
    produced.push({
      rowId: reference.rowId,
      columnId: reference.columnId,
      revision: updated.rows[0]?.revision ?? 1,
    });
  }
  return produced;
}

export async function insertColumn(
  client: Client,
  table: TableData,
  column: {
    name: string;
    type: ColumnType;
    formula: string | null;
    targetTableId: string | null;
  },
): Promise<string> {
  const columnId = newId('col');
  await client.query(
    `insert into doc_columns (id, table_id, name, type, formula, target_table_id, position, revision)
     values ($1, $2, $3, $4, $5, $6, $7, 1)`,
    [
      columnId,
      table.id,
      column.name,
      column.type,
      column.formula,
      column.targetTableId,
      table.columns.length,
    ],
  );
  if (column.type !== 'formula') {
    await client.query(
      `insert into doc_cells (row_id, column_id, raw, revision)
       select id, $2, null, 1 from doc_rows where table_id = $1`,
      [table.id, columnId],
    );
  }
  return columnId;
}

export async function setColumnDeleted(
  client: Client,
  columnId: string,
  deleted: boolean,
): Promise<number> {
  const result = await client.query<{ revision: number }>(
    'update doc_columns set deleted = $2, revision = revision + 1 where id = $1 returning revision',
    [columnId, deleted],
  );
  return result.rows[0]?.revision ?? 1;
}

export async function updateColumnFields(
  client: Client,
  columnId: string,
  fields: { name?: string; type?: ColumnType; formula?: string | null },
): Promise<number> {
  const result = await client.query<{ revision: number }>(
    `update doc_columns set
       name = coalesce($2, name),
       type = coalesce($3, type),
       formula = case when $4 then $5 else formula end,
       revision = revision + 1
     where id = $1 returning revision`,
    [
      columnId,
      fields.name ?? null,
      fields.type ?? null,
      fields.formula !== undefined,
      fields.formula ?? null,
    ],
  );
  return result.rows[0]?.revision ?? 1;
}

export async function setColumnFormula(
  client: Client,
  columnId: string,
  formula: string,
): Promise<number> {
  const result = await client.query<{ revision: number }>(
    'update doc_columns set formula = $2, revision = revision + 1 where id = $1 returning revision',
    [columnId, formula],
  );
  return result.rows[0]?.revision ?? 1;
}

export async function convertColumnValues(
  client: Client,
  table: TableData,
  column: ColumnData,
  type: ColumnType,
): Promise<{ converted: CellRevision[]; before: Array<{ rowId: string; raw: string | null }> }> {
  const cells = await client.query<{ row_id: string; raw: string | null }>(
    'select row_id, raw from doc_cells where column_id = $1',
    [column.id],
  );
  const converted: CellRevision[] = [];
  const before: Array<{ rowId: string; raw: string | null }> = [];
  for (const cell of cells.rows) {
    before.push({ rowId: cell.row_id, raw: cell.raw });
    if (cell.raw === null) continue;
    const next = convertDisplayToType(displayFromRaw(column.type, cell.raw), type);
    const written = await writeCells(client, [
      { rowId: cell.row_id, columnId: column.id, raw: next },
    ]);
    converted.push(...written);
  }
  return { converted, before };
}

export async function renameTable(
  client: Client,
  tableId: string,
  name: string,
): Promise<number> {
  const result = await client.query<{ revision: number }>(
    'update doc_tables set name = $2, revision = revision + 1 where id = $1 returning revision',
    [tableId, name],
  );
  return result.rows[0]?.revision ?? 1;
}

export async function applyFormulaRewrites(
  client: Client,
  rewrites: Map<string, string>,
): Promise<Array<{ columnId: string; revision: number }>> {
  const out: Array<{ columnId: string; revision: number }> = [];
  for (const [columnId, formula] of rewrites) {
    out.push({ columnId, revision: await setColumnFormula(client, columnId, formula) });
  }
  return out;
}

export function cellsOfColumn(table: TableData, columnId: string, rowIds: string[]): Set<string> {
  const keys = new Set<string>();
  for (const rowId of rowIds) keys.add(cellKey(rowId, columnId));
  return keys;
}

export function cellsOfRow(table: TableData, rowId: string): Set<string> {
  const keys = new Set<string>();
  for (const column of table.columns) keys.add(cellKey(rowId, column.id));
  return keys;
}
