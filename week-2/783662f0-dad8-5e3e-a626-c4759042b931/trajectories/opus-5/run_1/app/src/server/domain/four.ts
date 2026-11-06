/**
 * Four in a row, in one place. 7 columns by 6 rows, Ink first, a disc falls to
 * the lowest empty cell, four in a line wins and a full board is a draw.
 */

export const COLUMNS = 7;
export const ROWS = 6;

/** Rows top first, as the Table object publishes them. */
export type FourRows = readonly string[];

export const emptyRows = (): string[] => Array.from({ length: ROWS }, () => '.'.repeat(COLUMNS));

const DISCS = ['I', 'G'] as const;

export const discOfSeat = (seat: number): string => DISCS[seat - 1] ?? 'I';

export type FourRefusal = 'column_full' | 'bad_column';

export type FourApply =
  | { readonly ok: true; readonly rows: string[]; readonly row: number; readonly column: number }
  | { readonly ok: false; readonly refusal: FourRefusal };

/** Move strings are "1" to "7". */
export function applyDrop(rows: FourRows, move: string, seat: number): FourApply {
  if (!/^[1-7]$/.test(move)) return { ok: false, refusal: 'bad_column' };
  const column = Number(move) - 1;
  // Row 0 is the top row, so the lowest free cell is the last empty one down.
  let landing = -1;
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (rows[row][column] === '.') {
      landing = row;
      break;
    }
  }
  if (landing === -1) return { ok: false, refusal: 'column_full' };
  const next = rows.map((row, index) =>
    index === landing
      ? `${row.slice(0, column)}${discOfSeat(seat)}${row.slice(column + 1)}`
      : row,
  );
  return { ok: true, rows: next, row: landing, column };
}

export const legalDrops = (rows: FourRows): string[] => {
  const out: string[] = [];
  for (let column = 0; column < COLUMNS; column += 1) {
    if (rows.some((row) => row[column] === '.')) out.push(String(column + 1));
  }
  return out;
};

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/** True when the disc just played completes a line of four. */
export function isFourInARow(rows: FourRows, row: number, column: number): boolean {
  const disc = rows[row][column];
  if (disc === '.') return false;
  for (const [dr, dc] of DIRECTIONS) {
    let run = 1;
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = column + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLUMNS && rows[r][c] === disc) {
        run += 1;
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (run >= 4) return true;
  }
  return false;
}

export const isBoardFull = (rows: FourRows): boolean =>
  rows.every((row) => !row.includes('.'));

/** Cell names run columns a to g with row 1 at the bottom and row 6 at the top. */
export const cellName = (rowIndex: number, column: number): string =>
  `${'abcdefg'[column]}${ROWS - rowIndex}`;

export const discLabel = (disc: string): string =>
  disc === 'I' ? 'Ink disc' : disc === 'G' ? 'Gold disc' : 'empty';

