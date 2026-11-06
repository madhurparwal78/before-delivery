/** Four in a row rules, decided only here. 7 columns by 6 rows, Ink moves first. */

export const EmptyBoard = ["......", "......", "......", "......", "......", "......"];

export type Cell = "." | "I" | "G";

export function parseRows(rows: string[]): Cell[][] {
  return rows.map((r) => r.split("") as Cell[]);
}

export function toRows(cells: Cell[][]): string[] {
  return cells.map((r) => r.join(""));
}

export function dropRow(rows: string[], column: number): number | null {
  // rows[0] is the top row. The disc falls to the lowest free cell.
  for (let y = 5; y >= 0; y--) {
    const row = rows[y]!;
    if (row[column] === ".") return y;
  }
  return null;
}

export function isFull(rows: string[]): boolean {
  return rows.every((r) => !r.includes("."));
}

export function fourInLine(rows: string[], x: number, y: number): boolean {
  const cells = parseRows(rows);
  const disc = cells[y]![x]!;
  if (disc === ".") return false;
  const dirs: [number, number][] = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  for (const [dx, dy] of dirs) {
    let count = 1;
    for (const sign of [-1, 1]) {
      let fx = x + dx * sign;
      let fy = y + dy * sign;
      while (fy >= 0 && fy < 6 && fx >= 0 && fx < 7 && cells[fy]![fx] === disc) {
        count += 1;
        fx += dx * sign;
        fy += dy * sign;
      }
    }
    if (count >= 4) return true;
  }
  return false;
}

export interface FourOutcome {
  rows: string[];
  win: boolean;
  draw: boolean;
}

/** Applies a drop in column 1..7 for a seat (1 Ink, 2 Gold). */
export function applyDrop(rows: string[], column: number, seat: 1 | 2): FourOutcome | null {
  const idx = column - 1;
  if (idx < 0 || idx > 6) return null;
  const y = dropRow(rows, idx);
  if (y === null) return null;
  const cells = parseRows(rows);
  cells[y]![idx] = seat === 1 ? "I" : "G";
  const newRows = toRows(cells);
  const win = fourInLine(newRows, idx, y);
  const draw = !win && isFull(newRows);
  return { rows: newRows, win, draw };
}

/** Replay: applies every stored drop, ignoring whose turn it was. */
export function replayDrops(drops: string[]): { rows: string[]; ok: boolean } {
  let rows = EmptyBoard.slice();
  for (const [i, drop] of drops.entries()) {
    const seat = (i % 2 === 0 ? 1 : 2) as 1 | 2;
    const outcome = applyDrop(rows, Number(drop), seat);
    if (outcome === null) return { rows, ok: false };
    rows = outcome.rows;
  }
  return { rows, ok: true };
}
