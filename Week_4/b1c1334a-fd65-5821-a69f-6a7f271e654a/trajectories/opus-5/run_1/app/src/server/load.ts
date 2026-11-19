import type { Client } from './db.js';
import type { ColumnType, Role, RowScope, TableKind } from '../shared/api.js';
import {
  sumColumnName,
  summaryName,
  summarySumColumnId,
  SUMMARY_COUNT_COLUMN_ID,
  type ColumnData,
  type DocData,
  type RowData,
  type TableData,
} from './model.js';

export type DocumentAccess = { role: Role; rowScope: RowScope };

export async function documentAccess(
  client: Client,
  documentId: string,
  account: { id: string; email: string },
): Promise<DocumentAccess | null> {
  const owned = await client.query<{ id: string }>(
    'select id from documents where id = $1 and owner_id = $2',
    [documentId, account.id],
  );
  if (owned.rowCount === 1) return { role: 'owner', rowScope: 'all' };
  const shared = await client.query<{ role: Role; row_scope: RowScope }>(
    `select role, row_scope from shares
     where document_id = $1 and lower(email) = lower($2)`,
    [documentId, account.email],
  );
  const share = shared.rows[0];
  if (share === undefined) return null;
  return { role: share.role, rowScope: share.row_scope };
}

type TableRow = {
  id: string;
  name: string;
  kind: TableKind;
  revision: number;
  owner_column_id: string | null;
  source_table_id: string | null;
  group_by: string[] | null;
  sum_columns: string[] | null;
  seq: string;
};

export async function loadDocument(client: Client, documentId: string): Promise<DocData | null> {
  const documents = await client.query<{ id: string; name: string; revision: number }>(
    'select id, name, revision from documents where id = $1',
    [documentId],
  );
  const document = documents.rows[0];
  if (document === undefined) return null;

  const tableRows = await client.query<TableRow>(
    `select id, name, kind, revision, owner_column_id, source_table_id, group_by, sum_columns, seq
     from doc_tables where document_id = $1 order by seq`,
    [documentId],
  );
  const columnRows = await client.query<{
    id: string;
    table_id: string;
    name: string;
    type: ColumnType;
    formula: string | null;
    target_table_id: string | null;
    position: number;
    revision: number;
  }>(
    `select c.id, c.table_id, c.name, c.type, c.formula, c.target_table_id, c.position, c.revision
     from doc_columns c join doc_tables t on t.id = c.table_id
     where t.document_id = $1 and c.deleted = false
     order by c.position, c.id`,
    [documentId],
  );
  const rowRows = await client.query<{
    id: string;
    table_id: string;
    revision: number;
    seq: string;
    deleted: boolean;
  }>(
    `select r.id, r.table_id, r.revision, r.seq, r.deleted
     from doc_rows r join doc_tables t on t.id = r.table_id
     where t.document_id = $1 order by r.seq`,
    [documentId],
  );
  const cellRows = await client.query<{
    row_id: string;
    column_id: string;
    raw: string | null;
    revision: number;
  }>(
    `select c.row_id, c.column_id, c.raw, c.revision
     from doc_cells c
     join doc_rows r on r.id = c.row_id
     join doc_tables t on t.id = r.table_id
     where t.document_id = $1 and r.deleted = false`,
    [documentId],
  );

  const columnsByTable = new Map<string, ColumnData[]>();
  const columnById = new Map<string, ColumnData>();
  for (const row of columnRows.rows) {
    const column: ColumnData = {
      id: row.id,
      name: row.name,
      type: row.type,
      formula: row.formula,
      targetTableId: row.target_table_id,
      position: row.position,
      revision: row.revision,
    };
    columnById.set(column.id, column);
    const list = columnsByTable.get(row.table_id);
    if (list === undefined) columnsByTable.set(row.table_id, [column]);
    else list.push(column);
  }

  const cellsByRow = new Map<string, Map<string, { raw: string | null; revision: number }>>();
  for (const cell of cellRows.rows) {
    let map = cellsByRow.get(cell.row_id);
    if (map === undefined) {
      map = new Map();
      cellsByRow.set(cell.row_id, map);
    }
    map.set(cell.column_id, { raw: cell.raw, revision: cell.revision });
  }

  const rowsByTable = new Map<string, RowData[]>();
  const rowIndex = new Map<string, { tableId: string; deleted: boolean }>();
  for (const row of rowRows.rows) {
    rowIndex.set(row.id, { tableId: row.table_id, deleted: row.deleted });
    if (row.deleted) continue;
    const list = rowsByTable.get(row.table_id) ?? [];
    list.push({
      id: row.id,
      revision: row.revision,
      seq: Number(row.seq),
      cells: cellsByRow.get(row.id) ?? new Map(),
    });
    rowsByTable.set(row.table_id, list);
  }

  const tables: TableData[] = tableRows.rows.map((table) => ({
    id: table.id,
    name: table.name,
    kind: table.kind,
    revision: table.revision,
    ownerColumnId: table.owner_column_id,
    seq: Number(table.seq),
    columns: (columnsByTable.get(table.id) ?? []).slice().sort((a, b) => a.position - b.position),
    rows: rowsByTable.get(table.id) ?? [],
    summary:
      table.kind === 'summary' && table.source_table_id !== null
        ? {
            sourceTableId: table.source_table_id,
            groupBy: table.group_by ?? [],
            sumColumns: table.sum_columns ?? [],
          }
        : null,
  }));

  for (const table of tables) {
    if (table.summary === null) continue;
    const source = tables.find((candidate) => candidate.id === table.summary?.sourceTableId);
    if (source === undefined) continue;
    table.columns = summaryColumns(table.summary.groupBy, table.summary.sumColumns, columnById);
    table.name = summaryName(
      source.name,
      table.summary.groupBy.map((id) => columnById.get(id)?.name ?? ''),
    );
  }

  return { id: document.id, name: document.name, revision: document.revision, tables, rowIndex };
}

export function summaryColumns(
  groupBy: string[],
  sumColumns: string[],
  columnById: Map<string, ColumnData>,
): ColumnData[] {
  const columns: ColumnData[] = [];
  for (const id of groupBy) {
    const source = columnById.get(id);
    columns.push({
      id,
      name: source?.name ?? '',
      type: source?.type ?? 'text',
      formula: null,
      targetTableId: source?.targetTableId ?? null,
      position: columns.length,
      revision: 1,
    });
  }
  columns.push({
    id: SUMMARY_COUNT_COLUMN_ID,
    name: 'Count',
    type: 'decimal',
    formula: null,
    targetTableId: null,
    position: columns.length,
    revision: 1,
  });
  for (const id of sumColumns) {
    const source = columnById.get(id);
    columns.push({
      id: summarySumColumnId(id),
      name: sumColumnName(source?.name ?? ''),
      type: 'decimal',
      formula: null,
      targetTableId: null,
      position: columns.length,
      revision: 1,
    });
  }
  return columns;
}
