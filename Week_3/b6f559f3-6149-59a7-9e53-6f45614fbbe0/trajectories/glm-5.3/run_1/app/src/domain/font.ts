// The built-in Halation Block outline font, generated in code.
// Each glyph is a 3×5 grid of square cells.

export interface Glyph {
  rows: string[]; // five rows, top to bottom, '1' = filled
  cells: number;
}

export const GLYPHS: Record<string, Glyph> = {
  A: { rows: ['010', '101', '111', '101', '101'], cells: 10 },
  B: { rows: ['110', '101', '110', '101', '110'], cells: 10 },
  C: { rows: ['011', '100', '100', '100', '011'], cells: 7 },
  D: { rows: ['110', '101', '101', '101', '110'], cells: 10 },
  E: { rows: ['111', '100', '110', '100', '111'], cells: 10 },
  F: { rows: ['111', '100', '110', '100', '100'], cells: 8 },
  G: { rows: ['011', '100', '101', '101', '011'], cells: 9 },
  H: { rows: ['101', '101', '111', '101', '101'], cells: 11 },
  I: { rows: ['111', '010', '010', '010', '111'], cells: 9 },
  J: { rows: ['001', '001', '001', '101', '010'], cells: 6 },
  K: { rows: ['101', '101', '110', '101', '101'], cells: 10 },
  L: { rows: ['100', '100', '100', '100', '111'], cells: 7 },
  M: { rows: ['101', '111', '111', '101', '101'], cells: 12 },
  N: { rows: ['110', '101', '101', '101', '101'], cells: 10 },
  O: { rows: ['111', '101', '101', '101', '111'], cells: 12 },
  P: { rows: ['110', '101', '110', '100', '100'], cells: 8 },
  Q: { rows: ['010', '101', '101', '110', '011'], cells: 9 },
  R: { rows: ['110', '101', '110', '101', '101'], cells: 10 },
  S: { rows: ['011', '100', '010', '001', '110'], cells: 7 },
  T: { rows: ['111', '010', '010', '010', '010'], cells: 7 },
  U: { rows: ['101', '101', '101', '101', '111'], cells: 11 },
  V: { rows: ['101', '101', '101', '101', '010'], cells: 9 },
  W: { rows: ['101', '101', '111', '111', '101'], cells: 12 },
  X: { rows: ['101', '101', '010', '101', '101'], cells: 9 },
  Y: { rows: ['101', '101', '010', '010', '010'], cells: 7 },
  Z: { rows: ['111', '001', '010', '100', '111'], cells: 9 },
  '0': { rows: ['010', '101', '101', '101', '010'], cells: 8 },
  '1': { rows: ['010', '110', '010', '010', '111'], cells: 8 },
  '2': { rows: ['110', '001', '010', '100', '111'], cells: 8 },
  '3': { rows: ['110', '001', '010', '001', '110'], cells: 7 },
  '4': { rows: ['101', '101', '111', '001', '001'], cells: 9 },
  '5': { rows: ['111', '100', '110', '001', '110'], cells: 9 },
  '6': { rows: ['011', '100', '110', '101', '010'], cells: 8 },
  '7': { rows: ['111', '001', '010', '010', '010'], cells: 7 },
  '8': { rows: ['010', '101', '010', '101', '010'], cells: 7 },
  '9': { rows: ['010', '101', '011', '001', '110'], cells: 8 },
  '-': { rows: ['000', '000', '111', '000', '000'], cells: 3 },
  '.': { rows: ['000', '000', '000', '000', '010'], cells: 1 },
  '!': { rows: ['010', '010', '010', '000', '010'], cells: 4 },
};

export function isGlyphChar(c: string): boolean {
  return c === ' ' || Object.prototype.hasOwnProperty.call(GLYPHS, c);
}

export function glyphForChar(c: string): Glyph | null {
  return Object.prototype.hasOwnProperty.call(GLYPHS, c) ? GLYPHS[c] : null;
}

// Text metrics: each glyph cell is 0.6 wide, 1.0 tall, advance 0.7.
export function textWidth(text: string, letterHeight: number): number {
  return letterHeight * (0.7 * text.length - 0.1);
}

export interface FilledCell {
  charIndex: number;
  col: number; // 1..3
  row: number; // 1..5
  x0: number;
  y0: number;
  size: number;
}

// Cells for one glyph at index i (0-based), letterHeight h, text of n chars,
// the whole text centred on the origin.
export function cellsForChar(text: string, i: number, h: number): FilledCell[] {
  const g = glyphForChar(text[i]);
  if (!g) return [];
  const totalW = textWidth(text, h);
  const left = -totalW / 2 + i * 0.7 * h;
  const top = h / 2;
  const size = 0.2 * h;
  const out: FilledCell[] = [];
  for (let r = 1; r <= 5; r++) {
    for (let c = 1; c <= 3; c++) {
      if (g.rows[r - 1][c - 1] === '1') {
        out.push({
          charIndex: i,
          col: c,
          row: r,
          x0: left + (c - 1) * size,
          y0: top - r * size,
          size,
        });
      }
    }
  }
  return out;
}

export function totalFilledCells(text: string): number {
  let n = 0;
  for (const ch of text) {
    const g = glyphForChar(ch);
    if (g) n += g.cells;
  }
  return n;
}

export function textTriangles(text: string, bevelSegments: number, hasBevel: boolean): number {
  const cells = totalFilledCells(text);
  return cells * (hasBevel ? 12 + 16 * bevelSegments : 12);
}

// Extrusion triangles for a simple polygon of N points.
export function polygonTriangles(n: number, bevelSegments: number): number {
  return 4 * n - 4 + 4 * n * bevelSegments;
}

// Bounds for extruded text.
export function textBounds(text: string, letterHeight: number, depth: number, bevelSize: number): {
  w: number;
  h: number;
  d: number;
} {
  const grow = bevelSize > 0 ? 2 * bevelSize : 0;
  return {
    w: textWidth(text, letterHeight) + grow,
    h: letterHeight + grow,
    d: depth + grow,
  };
}
