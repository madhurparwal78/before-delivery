import type { Direction } from "./types.js";

export interface GridCell {
  row: number;
  col: number;
  index: number;
}

export interface WordIndex {
  number: number;
  direction: Direction;
  row: number;
  col: number;
  length: number;
  cells: GridCell[];
}

/** The one place where the Overlap numbering rule is decided. */
export function computeNumbering(cols: number, rows: number, white: boolean[][]): {
  number: number[][];
  words: WordIndex[];
} {
  const number: number[][] = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  const words: WordIndex[] = [];
  let next = 1;
  const whiteAt = (r: number, c: number): boolean => r >= 0 && r < rows && c >= 0 && c < cols && white[r]![c]!;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!whiteAt(r, c)) continue;
      const startsAcross = !whiteAt(r, c - 1) && whiteAt(r, c + 1);
      const startsDown = !whiteAt(r - 1, c) && whiteAt(r + 1, c);
      if (startsAcross || startsDown) {
        number[r]![c] = next;
        next++;
      }
      if (startsAcross) {
        const cells: GridCell[] = [];
        for (let cc = c; whiteAt(r, cc); cc++) cells.push({ row: r, col: cc, index: 0 });
        words.push({ number: number[r]![c]!, direction: "across", row: r, col: c, length: cells.length, cells });
      }
      if (startsDown) {
        const cells: GridCell[] = [];
        for (let rr = r; whiteAt(rr, c); rr++) cells.push({ row: rr, col: c, index: 0 });
        words.push({ number: number[r]![c]!, direction: "down", row: r, col: c, length: cells.length, cells });
      }
    }
  }
  for (const w of words) w.cells.forEach((cell, i) => (cell.index = i));
  return { number, words };
}

export function compareClue(a: { number: number; direction: Direction }, b: { number: number; direction: Direction }): number {
  if (a.direction !== b.direction) return a.direction === "across" ? -1 : 1;
  return a.number - b.number;
}
