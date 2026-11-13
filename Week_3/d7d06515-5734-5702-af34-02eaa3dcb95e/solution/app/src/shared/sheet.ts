// A3 landscape sheet layout shared by the PDF writer and the on-screen paper layout (brief: Business rules > Layouts and export).
// Sheet coordinates are millimetres on paper with the origin at the lower-left corner and y pointing up, like model space;
// a screen that draws y downwards uses `SHEET.height - y`.
import type { Bounds } from './geometry.ts';
import type { ColorName, LinetypeName, PlotStyle, Point, ViewportScale } from './types.ts';

export interface SheetRect { x: number; y: number; width: number; height: number }

export const SHEET = { width: 420, height: 297 } as const;
/** Drawing border, 10 mm inside the sheet edge. */
export const BORDER: SheetRect = { x: 10, y: 10, width: 400, height: 277 };
/** Title block, lower right, flush with the border. */
export const TITLE_BLOCK: SheetRect = { x: 250, y: 10, width: 160, height: 54 };
/** The one viewport frame (and, for a Model export, the drawing area), above the title block. */
export const VIEWPORT_FRAME: SheetRect = { x: 15, y: 69, width: 390, height: 213 };

const TITLE_LINE_PITCH = 8;
const TITLE_PADDING = 4;
const TITLE_FONT_SIZE = 4;
const TITLE_MIN_FONT_SIZE = 1;
/** A Model export keeps this much paper clear inside the drawing area. */
const FIT_MARGIN = 10;

const PAPER_SCALE_LABEL_FIT = 'FIT';

/** Model millimetres per paper millimetre for `1:<n>`. */
function scaleDenominator(scale: ViewportScale): number {
  return Number(scale.slice(2));
}

interface TitleBlockInput {
  /** Drawing name without `.dxf`. */
  title: string;
  /** The viewport scale of the layout, or null for a Model export. */
  scale: ViewportScale | null;
  /** Studio-zone issue date, YYYY-MM-DD. */
  issued: string;
  revision: string;
  note: string;
}

/** The six extractable lines, in block order. */
function titleBlockLines(input: TitleBlockInput): string[] {
  return [
    `TITLE ${input.title}`,
    'SHEET A-101',
    `SCALE ${input.scale ?? PAPER_SCALE_LABEL_FIT}`,
    `ISSUED ${input.issued}`,
    `REVISION ${input.revision}`,
    `NOTE ${input.note}`,
  ];
}

interface TitleBlockText { text: string; x: number; y: number; size: number }

/** Where each title-block line sits (left edge and baseline, font size in mm) so that it fits inside the block. */
export function titleBlockText(input: TitleBlockInput): TitleBlockText[] {
  const room = TITLE_BLOCK.width - 2 * TITLE_PADDING;
  return titleBlockLines(input).map((text, index) => {
    const natural = helveticaWidth(text, 1);
    const size = Math.max(TITLE_MIN_FONT_SIZE, Math.min(TITLE_FONT_SIZE, room / natural));
    return {
      text,
      x: TITLE_BLOCK.x + TITLE_PADDING,
      y: TITLE_BLOCK.y + TITLE_BLOCK.height - TITLE_PADDING - TITLE_LINE_PITCH * index - TITLE_FONT_SIZE,
      size,
    };
  });
}

/** Model -> sheet mapping: `x_sheet = x * factor + offsetX`, same for y. */
export interface ViewportTransform { factor: number; offsetX: number; offsetY: number }

/**
 * Centres the extents in the viewport frame. A viewport scale of `1:50` means 1 mm of paper is 50 mm of model; `null`
 * (a Model export) fits the extents into the frame, leaving `FIT_MARGIN` clear. No extents centre the origin.
 */
export function viewportTransform(extents: Bounds | null, scale: ViewportScale | null): ViewportTransform {
  const box = extents ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  let factor: number;
  if (scale !== null) {
    factor = 1 / scaleDenominator(scale);
  } else {
    const roomX = VIEWPORT_FRAME.width - 2 * FIT_MARGIN;
    const roomY = VIEWPORT_FRAME.height - 2 * FIT_MARGIN;
    const fits = [width > 0 ? roomX / width : Infinity, height > 0 ? roomY / height : Infinity];
    const smallest = Math.min(...fits);
    factor = Number.isFinite(smallest) ? smallest : 1;
  }
  const centreX = (box.minX + box.maxX) / 2;
  const centreY = (box.minY + box.maxY) / 2;
  return {
    factor,
    offsetX: VIEWPORT_FRAME.x + VIEWPORT_FRAME.width / 2 - centreX * factor,
    offsetY: VIEWPORT_FRAME.y + VIEWPORT_FRAME.height / 2 - centreY * factor,
  };
}

export function toSheet(transform: ViewportTransform, point: Point): Point {
  return [point[0] * transform.factor + transform.offsetX, point[1] * transform.factor + transform.offsetY];
}

/** Dash and gap lengths in paper millimetres at linetype scale 1 (empty = solid). */
export const LINETYPE_DASH: Record<LinetypeName, readonly number[]> = {
  Continuous: [],
  Dashed: [4, 2],
  Hidden: [2, 1.5],
  Center: [8, 2, 1, 2],
};

/** Print colours (0..1). Display White prints black. */
const PRINT_RGB: Record<ColorName, readonly [number, number, number]> = {
  Red: [0.9, 0, 0],
  Yellow: [0.75, 0.6, 0],
  Green: [0, 0.6, 0],
  Cyan: [0, 0.65, 0.75],
  Blue: [0, 0, 0.9],
  Magenta: [0.8, 0, 0.8],
  White: [0, 0, 0],
};

/** The stroke/fill colour a plot style prints for a drawing colour. Grayscale uses equal lightness (r = g = b). */
export function plotColor(style: PlotStyle, color: ColorName): [number, number, number] {
  if (style === 'Monochrome') return [0, 0, 0];
  const [r, g, b] = PRINT_RGB[color];
  if (style === 'Color') return [r, g, b];
  const grey = Math.round((0.299 * r + 0.587 * g + 0.114 * b) * 1000) / 1000;
  return [grey, grey, grey];
}

// Helvetica advance widths (per 1000 em) for WinAnsi 32..126; other glyphs use the digit width.
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const DEFAULT_GLYPH_WIDTH = 556;

/** Width in mm of `text` set in Helvetica at `size` mm. */
function helveticaWidth(text: string, size: number): number {
  let total = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    total += (code >= 32 && code <= 126 ? HELVETICA_WIDTHS[code - 32] : undefined) ?? DEFAULT_GLYPH_WIDTH;
  }
  return (total / 1000) * size;
}
