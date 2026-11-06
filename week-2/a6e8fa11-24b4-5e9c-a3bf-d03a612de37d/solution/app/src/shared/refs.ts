// Cell addresses, ranges and sheet-qualified references.
import { LIMITS } from "./limits.js";

interface CellAddress {
  row: number; // 1-based
  col: number; // 1-based, A = 1
}

export interface Area {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

const CELL = /^([A-Z])([1-9][0-9]{0,2})$/;
const AREA = /^([A-Z][1-9][0-9]{0,2})(?::([A-Z][1-9][0-9]{0,2}))?$/;

export function columnLetter(col: number): string {
  return String.fromCharCode(64 + col);
}

export function cellName(row: number, col: number): string {
  return `${columnLetter(col)}${row}`;
}

/** Parses an in-grid cell name ("A1" to "Z500"); anything else is null. */
export function parseCell(name: string): CellAddress | null {
  const m = CELL.exec(name);
  if (!m) return null;
  const row = Number(m[2]);
  if (row > LIMITS.maxRows) return null;
  return { row, col: m[1].charCodeAt(0) - 64 };
}

/** Parses "B2:C4" or a single cell into a normalised area; null when outside the grid. */
export function parseArea(text: string): Area | null {
  const m = AREA.exec(text);
  if (!m) return null;
  const a = parseCell(m[1]);
  const b = m[2] === undefined ? a : parseCell(m[2]);
  if (!a || !b) return null;
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col),
  };
}

export function areaText(area: Area): string {
  const start = cellName(area.top, area.left);
  const end = cellName(area.bottom, area.right);
  return start === end ? start : `${start}:${end}`;
}

export function areaSize(area: Area): number {
  return (area.bottom - area.top + 1) * (area.right - area.left + 1);
}

export function inArea(area: Area, row: number, col: number): boolean {
  return row >= area.top && row <= area.bottom && col >= area.left && col <= area.right;
}

export function* areaCells(area: Area): Generator<string> {
  for (let row = area.top; row <= area.bottom; row++) {
    for (let col = area.left; col <= area.right; col++) yield cellName(row, col);
  }
}

/** A sheet name as it appears in a reference: bare when only letters, digits and underscores. */
export function quoteSheetName(name: string): string {
  return /^[A-Za-z0-9_]+$/.test(name) ? name : `'${name.replaceAll("'", "''")}'`;
}

export function qualifiedArea(sheetName: string, area: Area): string {
  return `${quoteSheetName(sheetName)}!${areaText(area)}`;
}

export function qualifiedCell(sheetName: string, cell: string): string {
  return `${quoteSheetName(sheetName)}!${cell}`;
}

/** Splits "'Plot data'!A1:B4" into its sheet name and area text; a bare area has no sheet. */
export function splitQualified(text: string): { sheet: string | null; area: string } {
  const trimmed = text.trim();
  const quoted = /^'((?:[^']|'')+)'!(.+)$/.exec(trimmed);
  if (quoted) return { sheet: quoted[1].replaceAll("''", "'"), area: quoted[2].toUpperCase() };
  const bare = /^([^'!]+)!(.+)$/.exec(trimmed);
  if (bare) return { sheet: bare[1], area: bare[2].toUpperCase() };
  return { sheet: null, area: trimmed.toUpperCase() };
}
