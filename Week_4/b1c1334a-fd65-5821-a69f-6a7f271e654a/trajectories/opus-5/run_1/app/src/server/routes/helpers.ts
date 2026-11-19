import { notFound } from '../errors.js';
import { rowIsVisible, type ColumnData, type DocData, type RowData, type TableData, type Viewer } from '../model.js';

export function requireTable(doc: DocData, tableId: string | undefined): TableData {
  const table = doc.tables.find((candidate) => candidate.id === tableId);
  if (table === undefined) throw notFound();
  return table;
}

export function requireColumn(table: TableData, columnId: string | undefined): ColumnData {
  const column = table.columns.find((candidate) => candidate.id === columnId);
  if (column === undefined) throw notFound();
  return column;
}

export function requireVisibleRow(
  table: TableData,
  rowId: string | undefined,
  viewer: Viewer,
): RowData {
  const row = table.rows.find((candidate) => candidate.id === rowId);
  if (row === undefined || !rowIsVisible(table, row, viewer)) throw notFound();
  return row;
}

export function tableNameTaken(doc: DocData, name: string, exceptId: string | null): boolean {
  const wanted = name.toLowerCase();
  return doc.tables.some(
    (table) => table.id !== exceptId && table.name.toLowerCase() === wanted,
  );
}

export function columnNameTaken(
  table: TableData,
  name: string,
  exceptId: string | null,
): boolean {
  const wanted = name.toLowerCase();
  return table.columns.some(
    (column) => column.id !== exceptId && column.name.toLowerCase() === wanted,
  );
}

export function summaryUsesColumn(doc: DocData, columnId: string): boolean {
  return doc.tables.some(
    (table) =>
      table.summary !== null &&
      (table.summary.groupBy.includes(columnId) || table.summary.sumColumns.includes(columnId)),
  );
}
