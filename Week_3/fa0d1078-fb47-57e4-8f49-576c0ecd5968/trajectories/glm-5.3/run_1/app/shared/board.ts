export interface CellIndex {
  row: number; // 1 to 9
  col: number; // 1 to 9
}

// A board string is 81 characters, row by row from row 1 column 1 to row 9
// column 9, with "0" for an empty cell. Cell names are r<row>c<column>, with
// rows and columns numbered 1 to 9 from the top left. Boxes are numbered 1 to
// 9 left to right, top to bottom. A cell's peers are the 20 other cells in its
// row, column and box.
export const CELL_NAME_RE = /^r([1-9])c([1-9])$/;

export function cellIndex(index: number): CellIndex {
  return { row: Math.floor(index / 9) + 1, col: (index % 9) + 1 };
}

export function cellName(index: number): string {
  const { row, col } = cellIndex(index);
  return `r${row}c${col}`;
}

export function cellIndexFromName(name: string): number {
  const m = CELL_NAME_RE.exec(name);
  if (!m) return -1;
  return (Number(m[1]) - 1) * 9 + (Number(m[2]) - 1);
}

export function boxOf(index: number): number {
  const { row, col } = cellIndex(index);
  return Math.floor((row - 1) / 3) * 3 + Math.floor((col - 1) / 3) + 1;
}

const PEERS: number[][] = [];

for (let i = 0; i < 81; i++) {
  const { row, col } = cellIndex(i);
  const box = boxOf(i);
  const peers = new Set<number>();
  for (let j = 0; j < 81; j++) {
    if (j === i) continue;
    const o = cellIndex(j);
    if (o.row === row || o.col === col || boxOf(j) === box) peers.add(j);
  }
  PEERS[i] = [...peers];
}

export function peersOf(index: number): readonly number[] {
  return PEERS[index];
}

export function isValidBoardString(board: string): boolean {
  if (board.length !== 81) return false;
  for (const ch of board) if (ch < '0' || ch > '9') return false;
  return true;
}

export function countGivens(board: string): number {
  let n = 0;
  for (const ch of board) if (ch !== '0') n++;
  return n;
}

export interface BoardState {
  values: number[]; // 81 digits, 0 when empty
  wrong: boolean[]; // 81 flags, true on wrong entries
  hinted: boolean[]; // 81 flags, true on hinted cells
  notes: number[][]; // 81 arrays of digits ascending
}

export function boardStateFromEntries(entries: readonly number[]): BoardState {
  return {
    values: [...entries],
    wrong: new Array<boolean>(81).fill(false),
    hinted: new Array<boolean>(81).fill(false),
    notes: Array.from({ length: 81 }, () => [] as number[]),
  };
}

export function cloneBoard(b: BoardState): BoardState {
  return {
    values: [...b.values],
    wrong: [...b.wrong],
    hinted: [...b.hinted],
    notes: b.notes.map((n) => [...n]),
  };
}
