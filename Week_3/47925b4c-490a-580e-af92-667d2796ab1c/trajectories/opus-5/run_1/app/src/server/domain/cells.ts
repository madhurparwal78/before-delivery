export const CELL_METRES = 0.5;

const LETTERS = /^([A-Z]+)([1-9][0-9]*)$/;

export interface CellPosition {
  readonly column: number;
  readonly row: number;
}

export function columnLetters(column: number): string {
  let remaining = column;
  let letters = '';
  while (remaining > 0) {
    const index = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + index) + letters;
    remaining = (remaining - 1 - index) / 26;
  }
  return letters;
}

export function cellName(position: CellPosition): string {
  return `${columnLetters(position.column)}${position.row}`;
}

export function parseCellName(name: string): CellPosition | null {
  const parts = LETTERS.exec(name);
  if (parts === null) return null;
  const [, letters, digits] = parts;
  if (letters === undefined || digits === undefined) return null;
  let column = 0;
  for (const character of letters) {
    column = column * 26 + (character.charCodeAt(0) - 64);
  }
  return { column, row: Number(digits) };
}

export function cellCentre(position: CellPosition): { readonly across: number; readonly down: number } {
  return {
    across: (position.column - 0.5) * CELL_METRES,
    down: (position.row - 0.5) * CELL_METRES,
  };
}
