// Cell names: a bijective base-26 column letter sequence plus a 1-based row from the top.

export interface GridSize {
  columns: number;
  rows: number;
}

export function columnName(index: number): string {
  // 1 -> A, 26 -> Z, 27 -> AA (bijective base-26)
  let n = index;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function columnNumber(letters: string): number | null {
  if (!/^[A-Z]+$/.test(letters)) return null;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function cellName(column: number, row: number): string {
  return columnName(column) + row;
}

export function parseCell(name: string): { column: number; row: number } | null {
  const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(name);
  if (!match) return null;
  const column = columnNumber(match[1]!);
  if (column === null) return null;
  return { column, row: Number(match[2]!) };
}

export function parseCellOnGrid(name: string, size: GridSize): { column: number; row: number } | null {
  const parsed = parseCell(name);
  if (!parsed) return null;
  if (parsed.column > size.columns || parsed.row > size.rows) return null;
  return parsed;
}

// Cell centre in metres from the wall's top left.
export function cellCentre(column: number, row: number): { across: string; down: string } {
  return {
    across: String((column - 0.5) * 0.5),
    down: String((row - 0.5) * 0.5),
  };
}

export function cellsInOrder(size: GridSize): string[] {
  const out: string[] = [];
  for (let row = 1; row <= size.rows; row++) {
    for (let column = 1; column <= size.columns; column++) out.push(cellName(column, row));
  }
  return out;
}
