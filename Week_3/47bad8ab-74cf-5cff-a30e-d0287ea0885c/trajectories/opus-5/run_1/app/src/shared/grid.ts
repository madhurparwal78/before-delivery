export type Direction = 'across' | 'down';

export interface GridNumber {
  row: number;
  col: number;
  number: number;
}

export interface Word {
  number: number;
  direction: Direction;
  row: number;
  col: number;
  length: number;
}

export interface GridLayout {
  cols: number;
  rows: number;
  numbers: GridNumber[];
  words: Word[];
  orphans: { row: number; col: number }[];
}

export function directionLabel(direction: Direction): string {
  return direction === 'across' ? 'Across' : 'Down';
}

/**
 * Numbering and words for a black-square mask, by the Overlap rule: reading rows
 * top to bottom and squares left to right, a white square takes the next number
 * when it starts an Across or a Down word. Words come back in clue order.
 */
export function layoutGrid(black: boolean[][]): GridLayout {
  const rows = black.length;
  const cols = rows === 0 ? 0 : black[0].length;
  const white = (r: number, c: number): boolean =>
    r >= 0 && r < rows && c >= 0 && c < cols && !black[r][c];

  const numbers: GridNumber[] = [];
  const across: Word[] = [];
  const down: Word[] = [];
  const orphans: { row: number; col: number }[] = [];
  let next = 1;

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (!white(r, c)) continue;
      const startsAcross = !white(r, c - 1) && white(r, c + 1);
      const startsDown = !white(r - 1, c) && white(r + 1, c);
      const inAcross = white(r, c - 1) || white(r, c + 1);
      const inDown = white(r - 1, c) || white(r + 1, c);
      if (!inAcross && !inDown) orphans.push({ row: r, col: c });
      if (!startsAcross && !startsDown) continue;
      const number = next;
      next += 1;
      numbers.push({ row: r, col: c, number });
      if (startsAcross) {
        let length = 0;
        while (white(r, c + length)) length += 1;
        across.push({ number, direction: 'across', row: r, col: c, length });
      }
      if (startsDown) {
        let length = 0;
        while (white(r + length, c)) length += 1;
        down.push({ number, direction: 'down', row: r, col: c, length });
      }
    }
  }

  return { cols, rows, numbers, words: [...across, ...down], orphans };
}

export function wordSquares(word: Word): { row: number; col: number }[] {
  const squares: { row: number; col: number }[] = [];
  for (let i = 0; i < word.length; i += 1) {
    squares.push(
      word.direction === 'across'
        ? { row: word.row, col: word.col + i }
        : { row: word.row + i, col: word.col },
    );
  }
  return squares;
}

export function wordAt(
  layout: GridLayout,
  row: number,
  col: number,
  direction: Direction,
): Word | null {
  for (const word of layout.words) {
    if (word.direction !== direction) continue;
    if (direction === 'across') {
      if (word.row === row && col >= word.col && col < word.col + word.length) return word;
    } else if (word.col === col && row >= word.row && row < word.row + word.length) {
      return word;
    }
  }
  return null;
}

export function indexInWord(word: Word, row: number, col: number): number {
  return word.direction === 'across' ? col - word.col : row - word.row;
}

export function findWord(layout: GridLayout, number: number, direction: Direction): Word | null {
  return layout.words.find((w) => w.number === number && w.direction === direction) ?? null;
}

/** True when the white squares, joined side to side, form more than one group. */
export function whiteSquaresDisconnected(black: boolean[][]): boolean {
  const rows = black.length;
  const cols = rows === 0 ? 0 : black[0].length;
  let start: [number, number] | null = null;
  let whiteCount = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (!black[r][c]) {
        whiteCount += 1;
        if (!start) start = [r, c];
      }
    }
  }
  if (!start) return false;
  const seen = new Set<string>();
  const stack: [number, number][] = [start];
  while (stack.length > 0) {
    const [r, c] = stack.pop() as [number, number];
    const key = `${r},${c}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const [dr, dc] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (black[nr][nc]) continue;
      if (!seen.has(`${nr},${nc}`)) stack.push([nr, nc]);
    }
  }
  return seen.size !== whiteCount;
}
