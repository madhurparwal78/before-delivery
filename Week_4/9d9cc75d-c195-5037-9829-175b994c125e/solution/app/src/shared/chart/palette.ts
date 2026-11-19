// Mark colours, patterns and the sequential scale: the brief's colour rule, in one place for the SVG view and the PNG.
import { round9 } from '../display.ts';

export type PatternName = 'solid' | 'dots' | 'stripes' | 'checks' | 'rings';

/** Red, green, blue channel triples written as `data-color` writes them. */
export const MARK_COLOURS = ['233, 71, 159', '26, 10, 20', '217, 225, 63', '110, 74, 94', '234, 160, 205'] as const;
const MARK_PATTERNS: readonly PatternName[] = ['solid', 'dots', 'stripes', 'checks', 'rings'];

const BLUSH = [253, 241, 247] as const;
const BUBBLEGUM = [233, 71, 159] as const;
export const OUTLINE_COLOUR = '26, 10, 20';

interface MemberStyle {
  color: string;
  pattern: PatternName;
}

/** Members take colours and patterns in member order, cycling. */
export function memberStyle(index: number): MemberStyle {
  const at = index % MARK_COLOURS.length;
  return { color: MARK_COLOURS[at] ?? MARK_COLOURS[0], pattern: MARK_PATTERNS[at] ?? 'solid' };
}

/** The colour of a Color measure value: each channel `low + (high - low) * t`, rounded half up. */
export function sequentialColour(value: number, min: number, max: number): string {
  const t = max === min ? 1 : (value - min) / (max - min);
  return BLUSH.map((low, i) => Math.floor(round9(low + ((BUBBLEGUM[i] ?? low) - low) * t) + 0.5)).join(', ');
}

export const LOW_COLOUR = BLUSH.join(', ');
export const HIGH_COLOUR = BUBBLEGUM.join(', ');

/** One drawing primitive of a pattern tile, in a 10 x 10 tile; `ink` is true for the pattern colour and false for none. */
type TileShape =
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: boolean }
  | { kind: 'rect'; x: number; y: number; width: number; height: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; width: number };

export const TILE_SIZE = 10;

const TILES: Record<PatternName, TileShape[]> = {
  solid: [],
  dots: [{ kind: 'circle', cx: 5, cy: 5, r: 1.8, fill: true }],
  stripes: [
    { kind: 'line', x1: -1, y1: 11, x2: 11, y2: -1, width: 2.4 },
    { kind: 'line', x1: -6, y1: 6, x2: 6, y2: -6, width: 2.4 },
    { kind: 'line', x1: 4, y1: 16, x2: 16, y2: 4, width: 2.4 },
  ],
  checks: [
    { kind: 'rect', x: 0, y: 0, width: 5, height: 5 },
    { kind: 'rect', x: 5, y: 5, width: 5, height: 5 },
  ],
  rings: [{ kind: 'circle', cx: 5, cy: 5, r: 3, fill: false }],
};

export function patternTile(pattern: PatternName): readonly TileShape[] {
  return TILES[pattern];
}

/** The pattern ink that reads against a mark colour: blush on dark colours, plum on light ones. */
export function patternInk(color: string): string {
  const [r = 0, g = 0, b = 0] = color.split(',').map((c) => Number(c));
  return (r * 299 + g * 587 + b * 114) / 1000 < 128 ? LOW_COLOUR : OUTLINE_COLOUR;
}
