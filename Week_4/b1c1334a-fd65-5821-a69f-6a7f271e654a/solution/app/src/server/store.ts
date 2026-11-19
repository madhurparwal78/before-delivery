// Loading a document's state from Postgres and writing back exactly what an edit changed.
import type { Db } from "./db.js";
import type { DocumentRow } from "./edit.js";
import type { CellRec, ColumnRec, DocState, RowRec, Stored, TableRec } from "./model.js";
import { cellKey } from "./model.js";

export async function loadState(db: Db, doc: DocumentRow): Promise<DocState> {
  // node-postgres queues these on the one client, so they run in order inside the transaction.
  const [tables, columns, rows, cells] = await Promise.all([
    db.query("SELECT * FROM doc_tables WHERE document_id = $1", [doc.id]),
    db.query("SELECT * FROM doc_columns WHERE document_id = $1", [doc.id]),
    db.query("SELECT * FROM doc_rows WHERE document_id = $1", [doc.id]),
    db.query("SELECT row_id, column_id, value, revision, writer FROM doc_cells WHERE document_id = $1", [doc.id]),
  ]);
  return {
    id: doc.id,
    name: doc.name,
    ownerId: doc.owner_id,
    revision: doc.revision,
    tables: tables.rows.map(
      (t): TableRec => ({
        id: t.id, name: t.name, kind: t.kind, revision: t.revision, ownerColumnId: t.owner_column_id,
        sourceTableId: t.source_table_id, groupBy: t.group_by, sumColumns: t.sum_columns, seq: t.seq, writer: t.writer,
      }),
    ),
    columns: columns.rows.map(
      (c): ColumnRec => ({
        id: c.id, tableId: c.table_id, name: c.name, type: c.type, formula: c.formula, targetTableId: c.target_table_id,
        position: c.position, revision: c.revision, deleted: c.deleted, writer: c.writer,
      }),
    ),
    rows: rows.rows.map(
      (r): RowRec => ({ id: r.id, tableId: r.table_id, seq: r.seq, revision: r.revision, deleted: r.deleted, writer: r.writer }),
    ),
    cells: new Map(
      cells.rows.map((c) => [cellKey(c.row_id, c.column_id), { value: c.value as Stored, revision: c.revision, writer: c.writer }]),
    ),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Upserts every table, column, row and cell that differs between the two states.
export async function persistState(db: Db, before: DocState, after: DocState): Promise<void> {
  const changed = <T extends { id: string }>(old: T[], now: T[]) => {
    const index = new Map(old.map((x) => [x.id, x]));
    return now.filter((x) => !same(index.get(x.id), x));
  };
  const tables = changed(before.tables, after.tables).map((t) => ({
    id: t.id, document_id: after.id, name: t.name, kind: t.kind, revision: t.revision, owner_column_id: t.ownerColumnId,
    source_table_id: t.sourceTableId, group_by: t.groupBy, sum_columns: t.sumColumns, seq: t.seq, writer: t.writer,
  }));
  const columns = changed(before.columns, after.columns).map((c) => ({
    id: c.id, document_id: after.id, table_id: c.tableId, name: c.name, type: c.type, formula: c.formula,
    target_table_id: c.targetTableId, position: c.position, revision: c.revision, deleted: c.deleted, writer: c.writer,
  }));
  const rows = changed(before.rows, after.rows).map((r) => ({
    id: r.id, document_id: after.id, table_id: r.tableId, seq: r.seq, revision: r.revision, deleted: r.deleted, writer: r.writer,
  }));
  const cells: { document_id: string; row_id: string; column_id: string; value: Stored; revision: number; writer: string }[] = [];
  for (const [key, cell] of after.cells) {
    if (same(before.cells.get(key), cell)) continue;
    const [rowId, columnId] = key.split("|") as [string, string];
    cells.push({ document_id: after.id, row_id: rowId, column_id: columnId, value: cell.value, revision: cell.revision, writer: cell.writer });
  }
  if (tables.length) {
    await db.query(
      `INSERT INTO doc_tables SELECT * FROM jsonb_populate_recordset(NULL::doc_tables, $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, revision = EXCLUDED.revision,
         owner_column_id = EXCLUDED.owner_column_id, writer = EXCLUDED.writer`,
      [JSON.stringify(tables)],
    );
  }
  if (columns.length) {
    await db.query(
      `INSERT INTO doc_columns SELECT * FROM jsonb_populate_recordset(NULL::doc_columns, $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, formula = EXCLUDED.formula,
         position = EXCLUDED.position, revision = EXCLUDED.revision, deleted = EXCLUDED.deleted, writer = EXCLUDED.writer`,
      [JSON.stringify(columns)],
    );
  }
  if (rows.length) {
    await db.query(
      `INSERT INTO doc_rows SELECT * FROM jsonb_populate_recordset(NULL::doc_rows, $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET revision = EXCLUDED.revision, deleted = EXCLUDED.deleted, writer = EXCLUDED.writer`,
      [JSON.stringify(rows)],
    );
  }
  if (cells.length) {
    await db.query(
      `INSERT INTO doc_cells (document_id, row_id, column_id, value, revision, writer)
       SELECT x.document_id, x.row_id, x.column_id, x.value, x.revision, x.writer
       FROM jsonb_to_recordset($1::jsonb) AS x(document_id text, row_id text, column_id text, value jsonb, revision integer, writer text)
       ON CONFLICT (row_id, column_id) DO UPDATE SET value = EXCLUDED.value, revision = EXCLUDED.revision, writer = EXCLUDED.writer`,
      [JSON.stringify(cells)],
    );
  }
}

export function cellOf(state: DocState, rowId: string, columnId: string): CellRec {
  return state.cells.get(cellKey(rowId, columnId)) ?? { value: null, revision: 1, writer: "" };
}
