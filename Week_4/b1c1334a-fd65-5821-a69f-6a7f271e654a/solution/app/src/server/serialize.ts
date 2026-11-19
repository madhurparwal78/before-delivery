// The API's JSON shapes for tables, columns, rows and cells, in the caller's view.
import type { CellOut, Evaluation } from "./engine.js";
import type { ColumnRec, RowRec, TableRec } from "./model.js";

export function cellJson(out: CellOut) {
  return { value: out.value, display: out.display, kind: out.kind, revision: out.revision };
}

export function columnJson(column: ColumnRec) {
  return {
    id: column.id,
    name: column.name,
    type: column.type,
    formula: column.formula,
    target_table_id: column.targetTableId,
    position: column.position,
    revision: column.revision,
  };
}

export function rowJson(ev: Evaluation, row: RowRec) {
  const cells: Record<string, ReturnType<typeof cellJson>> = {};
  for (const column of ev.columns(row.tableId)) cells[column.id] = cellJson(ev.out(row, column));
  return { id: row.id, revision: row.revision, cells };
}

function tableColumnsAndRows(ev: Evaluation, table: TableRec) {
  if (table.kind === "table") {
    return {
      columns: ev.columns(table.id).map(columnJson),
      rows: ev.visibleRows(table.id).map((r) => rowJson(ev, r)),
    };
  }
  const s = ev.summary(table);
  return {
    columns: s.columns.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.source ? c.source.type : "decimal",
      formula: null,
      target_table_id: c.source?.targetTableId ?? null,
      position: c.position,
      revision: 1,
    })),
    rows: s.groups.map((g) => {
      const cells: Record<string, ReturnType<typeof cellJson>> = {};
      for (const c of s.columns) cells[c.id] = cellJson(ev.summaryOut(table, g, c));
      return { id: g.id, revision: null, cells };
    }),
  };
}

export function tableJson(ev: Evaluation, table: TableRec) {
  return {
    id: table.id,
    name: ev.tableName(table),
    kind: table.kind,
    revision: table.revision,
    owner_column_id: table.ownerColumnId,
    ...tableColumnsAndRows(ev, table),
  };
}

export function tableSummaryJson(ev: Evaluation, table: TableRec) {
  const counts =
    table.kind === "summary"
      ? { row_count: ev.summary(table).groups.length, column_count: ev.summary(table).columns.length }
      : { row_count: ev.visibleRows(table.id).length, column_count: ev.columns(table.id).length };
  return {
    id: table.id,
    name: ev.tableName(table),
    kind: table.kind,
    revision: table.revision,
    ...counts,
    source_table_id: table.sourceTableId,
  };
}
