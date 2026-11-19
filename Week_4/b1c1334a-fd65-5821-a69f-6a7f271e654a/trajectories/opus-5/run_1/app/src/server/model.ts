import type { ColumnType, Role, RowScope, TableKind } from '../shared/api.js';

/** A stored data cell. `raw` holds the canonical text of its column's type, or null for blank. */
export type StoredCell = { raw: string | null; revision: number };

export type ColumnData = {
  id: string;
  name: string;
  type: ColumnType;
  formula: string | null;
  targetTableId: string | null;
  position: number;
  revision: number;
};

export type RowData = {
  id: string;
  revision: number;
  seq: number;
  cells: Map<string, StoredCell>;
};

export type SummarySpec = {
  sourceTableId: string;
  groupBy: string[];
  sumColumns: string[];
};

export type TableData = {
  id: string;
  name: string;
  kind: TableKind;
  revision: number;
  ownerColumnId: string | null;
  seq: number;
  columns: ColumnData[];
  rows: RowData[];
  summary: SummarySpec | null;
};

export type DocData = {
  id: string;
  name: string;
  revision: number;
  tables: TableData[];
  rowIndex: Map<string, { tableId: string; deleted: boolean }>;
};

export type Viewer = {
  id: string;
  email: string;
  role: Role;
  rowScope: RowScope;
};

export const SUMMARY_COUNT_COLUMN_ID = 'count';

export function summarySumColumnId(sourceColumnId: string): string {
  return `sum:${sourceColumnId}`;
}

export function tableById(doc: DocData, tableId: string): TableData | undefined {
  return doc.tables.find((table) => table.id === tableId);
}

export function columnById(table: TableData, columnId: string): ColumnData | undefined {
  return table.columns.find((column) => column.id === columnId);
}

export function columnByName(table: TableData, name: string): ColumnData | undefined {
  const wanted = name.toLowerCase();
  return table.columns.find((column) => column.name.toLowerCase() === wanted);
}

export function tableByName(doc: DocData, name: string): TableData | undefined {
  const wanted = name.toLowerCase();
  return doc.tables.find((table) => table.name.toLowerCase() === wanted);
}

export function displayColumn(table: TableData): ColumnData | undefined {
  return table.columns[0];
}

export function summaryName(sourceName: string, groupColumnNames: string[]): string {
  return `${sourceName} by ${groupColumnNames.join(' and ')}`;
}

export function sumColumnName(sourceColumnName: string): string {
  return `Sum of ${sourceColumnName}`;
}

/** Row visibility under the caller's row scope. The one place rows are hidden. */
export function rowIsVisible(table: TableData, row: RowData, viewer: Viewer): boolean {
  if (viewer.role === 'owner' || viewer.rowScope === 'all') return true;
  if (table.ownerColumnId === null) return true;
  const owner = row.cells.get(table.ownerColumnId);
  const raw = owner?.raw ?? null;
  if (raw === null) return false;
  return raw.trim().toLowerCase() === viewer.email.trim().toLowerCase();
}

export function visibleRows(table: TableData, viewer: Viewer): RowData[] {
  return table.rows.filter((row) => rowIsVisible(table, row, viewer));
}
