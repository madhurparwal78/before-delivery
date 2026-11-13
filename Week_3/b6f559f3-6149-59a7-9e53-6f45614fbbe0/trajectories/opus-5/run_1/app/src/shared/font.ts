/** The built-in Halation Block outline font, generated in code: 3 columns by 5 rows per glyph. */
const GLYPH_ROWS: Record<string, string[]> = {
  A: ['010', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '010'],
  K: ['101', '101', '110', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'],
  N: ['110', '101', '101', '101', '101'],
  O: ['111', '101', '101', '101', '111'],
  P: ['110', '101', '110', '100', '100'],
  Q: ['010', '101', '101', '110', '011'],
  R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'],
  X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'],
  Z: ['111', '001', '010', '100', '111'],
  '0': ['010', '101', '101', '101', '010'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['110', '001', '010', '100', '111'],
  '3': ['110', '001', '010', '001', '110'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '110', '001', '110'],
  '6': ['011', '100', '110', '101', '010'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['010', '101', '010', '101', '010'],
  '9': ['010', '101', '011', '001', '110'],
  '-': ['000', '000', '111', '000', '000'],
  '.': ['000', '000', '000', '000', '010'],
  '!': ['010', '010', '010', '000', '010'],
  ' ': ['000', '000', '000', '000', '000'],
};

export const GLYPH_CELL_WIDTH = 0.6;
export const GLYPH_CELL_HEIGHT = 1;
export const GLYPH_ADVANCE = 0.7;
export const GLYPH_CELL_SIZE = 0.2;

export function normaliseGlyphText(text: string): string {
  return text.toUpperCase();
}

export function unsupportedCharacter(text: string): string | null {
  for (const character of normaliseGlyphText(text)) {
    if (!(character in GLYPH_ROWS)) return character;
  }
  return null;
}

export function glyphRows(character: string): string[] {
  return GLYPH_ROWS[character] ?? GLYPH_ROWS[' '];
}

export function filledCellCount(text: string): number {
  let count = 0;
  for (const character of normaliseGlyphText(text)) {
    for (const row of glyphRows(character)) {
      for (const cell of row) if (cell === '1') count += 1;
    }
  }
  return count;
}

export function textOutlineWidth(text: string, letterHeight: number): number {
  const length = [...text].length;
  if (length === 0) return 0;
  return letterHeight * (GLYPH_ADVANCE * length - 0.1);
}

export interface GlyphCellRect {
  left: number;
  top: number;
  size: number;
}

/** The filled cells of a text string, placed in the layer's local xy plane. */
export function textCells(text: string, letterHeight: number): GlyphCellRect[] {
  const width = textOutlineWidth(text, letterHeight);
  const size = GLYPH_CELL_SIZE * letterHeight;
  const cells: GlyphCellRect[] = [];
  const characters = [...normaliseGlyphText(text)];
  characters.forEach((character, index) => {
    const left = -width / 2 + index * GLYPH_ADVANCE * letterHeight;
    const top = (GLYPH_CELL_HEIGHT * letterHeight) / 2;
    glyphRows(character).forEach((row, rowIndex) => {
      [...row].forEach((cell, columnIndex) => {
        if (cell !== '1') return;
        cells.push({
          left: left + columnIndex * size,
          top: top - rowIndex * size,
          size,
        });
      });
    });
  });
  return cells;
}

export interface GlyphCellBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The glyph cell boxes of every non-space character, in order. */
export function textGlyphCellBoxes(text: string, letterHeight: number): GlyphCellBox[] {
  const width = textOutlineWidth(text, letterHeight);
  const boxes: GlyphCellBox[] = [];
  [...normaliseGlyphText(text)].forEach((character, index) => {
    if (character === ' ') return;
    const left = -width / 2 + index * GLYPH_ADVANCE * letterHeight;
    boxes.push({
      left,
      right: left + GLYPH_CELL_WIDTH * letterHeight,
      top: (GLYPH_CELL_HEIGHT * letterHeight) / 2,
      bottom: -(GLYPH_CELL_HEIGHT * letterHeight) / 2,
    });
  });
  return boxes;
}
