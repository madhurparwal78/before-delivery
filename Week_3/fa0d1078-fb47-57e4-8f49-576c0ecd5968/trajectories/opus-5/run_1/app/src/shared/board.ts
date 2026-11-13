export type Digit = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** A cell name such as `r4c3`. */
export type Cell = string;

export const DIGITS: readonly Digit[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export const CELLS: readonly Cell[] = (() => {
  const cells: Cell[] = [];
  for (let row = 1; row <= 9; row += 1) {
    for (let column = 1; column <= 9; column += 1) cells.push(`r${row}c${column}`);
  }
  return cells;
})();

export function cellName(row: number, column: number): Cell {
  return `r${row}c${column}`;
}

export function cellRow(cell: Cell): number {
  return Number(cell[1]);
}

export function cellColumn(cell: Cell): number {
  return Number(cell[3]);
}

export function cellIndex(cell: Cell): number {
  return (cellRow(cell) - 1) * 9 + (cellColumn(cell) - 1);
}

/** Boxes are numbered 1 to 9 left to right, top to bottom. */
export function cellBox(cell: Cell): number {
  return Math.floor((cellRow(cell) - 1) / 3) * 3 + Math.floor((cellColumn(cell) - 1) / 3) + 1;
}

export function isCellName(value: unknown): value is Cell {
  return typeof value === 'string' && /^r[1-9]c[1-9]$/.test(value);
}

export function isDigit(value: unknown): value is Digit {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 9;
}

const PEERS = new Map<Cell, readonly Cell[]>();
for (const cell of CELLS) {
  const peers: Cell[] = [];
  for (const other of CELLS) {
    if (other === cell) continue;
    if (
      cellRow(other) === cellRow(cell) ||
      cellColumn(other) === cellColumn(cell) ||
      cellBox(other) === cellBox(cell)
    ) {
      peers.push(other);
    }
  }
  PEERS.set(cell, peers);
}

/** The 20 other cells in the cell's row, column and box. */
export function peersOf(cell: Cell): readonly Cell[] {
  const peers = PEERS.get(cell);
  if (!peers) throw new Error(`unknown cell ${cell}`);
  return peers;
}

export function boardDigit(board: string, cell: Cell): Digit | null {
  const character = board[cellIndex(cell)];
  const digit = Number(character);
  return digit === 0 ? null : (digit as Digit);
}

export function givenCells(puzzle: string): Set<Cell> {
  const givens = new Set<Cell>();
  for (const cell of CELLS) if (boardDigit(puzzle, cell) !== null) givens.add(cell);
  return givens;
}
