/** Rounding half up for non-negative integers: rh(n, d) = floor((2n + d) / (2d)). */
export const rh = (n: number, d: number): number => Math.floor((2 * n + d) / (2 * d));

export const TOOLS = ['pencil', 'eraser', 'line', 'rectangle', 'ellipse', 'fill', 'dither', 'selection', 'picker'] as const;
export type Tool = (typeof TOOLS)[number];
export type StrokeTool = Exclude<Tool, 'selection' | 'picker'>;
export const STROKE_TOOLS: readonly StrokeTool[] = ['pencil', 'eraser', 'line', 'rectangle', 'ellipse', 'fill', 'dither'];
export const MIRRORS = ['none', 'x', 'y', 'both'] as const;
export type Mirror = (typeof MIRRORS)[number];
export const BLENDS = ['normal', 'multiply'] as const;
export type Blend = (typeof BLENDS)[number];
export const DIRECTIONS = ['forward', 'reverse', 'pingpong'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const SELECTION_OPS = ['move', 'paste', 'flip_h', 'flip_v', 'rotate'] as const;
export type SelectionOp = (typeof SELECTION_OPS)[number];
export const ZOOMS = [1, 2, 4, 8, 16, 32] as const;
export const NUMBER_FORMATS = ['en-US', 'en-IN'] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];
export const TIME_ZONES = ['UTC', 'Asia/Kolkata', 'America/New_York'] as const;
export type TimeZone = (typeof TIME_ZONES)[number];
export const ROLES = ['owner', 'editor', 'reviewer'] as const;
export type Role = (typeof ROLES)[number];

export const BRUSH_MAX = 8;
export const DITHER_MATRIX: readonly (readonly number[])[] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
/** Edge-mask bits: north, east, south, west. */
export const EDGE_N = 1;
export const EDGE_E = 2;
export const EDGE_S = 4;
export const EDGE_W = 8;
export const DEFAULT_EDGE_TABLE: readonly number[] = Array.from({ length: 16 }, (_, mask) => mask + 1);

export const COMMENT_MAX = 2000;
export const TAG_REPEAT_MAX = 99;
export const SCALE_MAX = 16;
export const PADDING_MAX = 64;
export const EXTRUDE_MAX = 16;
