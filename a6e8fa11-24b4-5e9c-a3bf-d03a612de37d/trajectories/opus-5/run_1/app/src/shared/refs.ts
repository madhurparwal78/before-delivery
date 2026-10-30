import { LIMITS } from './limits';

export interface CellAddress {
  col: number;
  row: number;
}

const CELL_RE = /^([A-Z]{1,2})([0-9]{1,3})$/;

export function columnLetter(col: number): string {
  return String.fromCharCode(64 + col);
}

export function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function parseCellRef(ref: string): CellAddress | null {
  const m = CELL_RE.exec(ref.toUpperCase());
  if (!m) return null;
  const col = columnNumber(m[1]);
  const row = Number(m[2]);
  if (col < 1 || col > LIMITS.maxColumns) return null;
  if (row < 1 || row > LIMITS.maxRows) return null;
  return { col, row };
}

export function formatCellRef(addr: CellAddress): string {
  return `${columnLetter(addr.col)}${addr.row}`;
}

export interface RangeAddress {
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

export function parseRangeRef(range: string): RangeAddress | null {
  const parts = range.split(':');
  if (parts.length === 1) {
    const one = parseCellRef(parts[0]);
    if (!one) return null;
    return { startCol: one.col, startRow: one.row, endCol: one.col, endRow: one.row };
  }
  if (parts.length !== 2) return null;
  const a = parseCellRef(parts[0]);
  const b = parseCellRef(parts[1]);
  if (!a || !b) return null;
  return {
    startCol: Math.min(a.col, b.col),
    startRow: Math.min(a.row, b.row),
    endCol: Math.max(a.col, b.col),
    endRow: Math.max(a.row, b.row),
  };
}

export function formatRangeRef(r: RangeAddress): string {
  const start = formatCellRef({ col: r.startCol, row: r.startRow });
  const end = formatCellRef({ col: r.endCol, row: r.endRow });
  return start === end ? start : `${start}:${end}`;
}

export function rangeCellCount(r: RangeAddress): number {
  return (r.endCol - r.startCol + 1) * (r.endRow - r.startRow + 1);
}

export function rangeCells(r: RangeAddress): string[] {
  const out: string[] = [];
  for (let row = r.startRow; row <= r.endRow; row++) {
    for (let col = r.startCol; col <= r.endCol; col++) {
      out.push(formatCellRef({ col, row }));
    }
  }
  return out;
}

const PLAIN_SHEET_NAME_RE = /^[A-Za-z0-9_]+$/;

export function quoteSheetName(name: string): string {
  return PLAIN_SHEET_NAME_RE.test(name) ? name : `'${name}'`;
}

export function qualifiedRange(sheetName: string, range: string): string {
  return `${quoteSheetName(sheetName)}!${range}`;
}

export function qualifiedRef(sheetName: string, cell: string): string {
  return `${quoteSheetName(sheetName)}!${cell}`;
}

export interface SplitQualified {
  sheetName: string | null;
  rest: string;
}

export function splitQualified(text: string): SplitQualified | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("'")) {
    const end = trimmed.indexOf("'", 1);
    if (end < 0 || trimmed[end + 1] !== '!') return null;
    return { sheetName: trimmed.slice(1, end), rest: trimmed.slice(end + 2) };
  }
  const bang = trimmed.indexOf('!');
  if (bang < 0) return { sheetName: null, rest: trimmed };
  return { sheetName: trimmed.slice(0, bang), rest: trimmed.slice(bang + 1) };
}

export function cellKey(sheetId: string, cell: string): string {
  return `${sheetId}!${cell}`;
}
