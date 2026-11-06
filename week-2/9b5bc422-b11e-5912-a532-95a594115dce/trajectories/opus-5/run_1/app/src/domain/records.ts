import { formatNumber } from './format.ts';
import { fieldValue } from './materialise.ts';
import type { CellValue, Column, RowRecord, TableRecord } from './types.ts';

export function cellValue(row: RowRecord, columnId: string): CellValue {
  const field = row.cells[columnId];
  return field ? fieldValue<CellValue>(field, null) : null;
}

export function cellDisplay(value: CellValue, column: Column): string {
  if (column.type === 'checkbox') return value === true ? 'true' : 'false';
  if (value === null || value === undefined || value === '') return '';
  if (column.type === 'number') return formatNumber(Number(value));
  return String(value);
}

export function rowMatches(row: RowRecord, columns: Column[], filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return columns.some((column) => cellDisplay(cellValue(row, column.id), column).toLowerCase().includes(needle));
}

export function columnTotal(rows: RowRecord[], column: Column): number {
  let total = 0;
  for (const row of rows) {
    const value = cellValue(row, column.id);
    if (value === null || value === '' || value === undefined) continue;
    total += Number(value);
  }
  return Math.round(total * 100) / 100;
}

export function firstNumberColumn(table: TableRecord): Column | null {
  return table.columns.find((column) => column.type === 'number') ?? null;
}

function firstTextColumn(table: TableRecord): Column | null {
  return table.columns.find((column) => column.type === 'text') ?? null;
}

export function rowTitle(row: RowRecord, table: TableRecord): string {
  const column = firstTextColumn(table);
  if (!column) return 'Untitled';
  const text = cellDisplay(cellValue(row, column.id), column);
  return text.trim() ? text : 'Untitled';
}

export function selectColumns(table: TableRecord): Column[] {
  return table.columns.filter((column) => column.type === 'select');
}

/** `Untitled table`, then the lowest number from 2 upward that leaves the name unused. */
export function nextTableName(existing: string[]): string {
  const base = 'Untitled table';
  if (!existing.includes(base)) return base;
  let candidate = 2;
  while (existing.includes(`${base} ${candidate}`)) candidate += 1;
  return `${base} ${candidate}`;
}

export function parseOptions(raw: string): string[] {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const part of raw.split(',')) {
    const option = part.trim();
    if (!option || seen.has(option)) continue;
    seen.add(option);
    options.push(option);
  }
  return options;
}
