import { DITHER_MATRIX, type Mirror, type SelectionOp, type StrokeTool } from './rules';

export type Point = readonly [number, number];

/** A cel is a row-major array of swatch indices; index 0 is transparent. */
export interface CelShape {
  readonly width: number;
  readonly height: number;
}

export interface StrokeOptions {
  filled?: boolean;
  contiguous?: boolean;
  secondary?: number;
  level?: number;
  pixel_perfect?: boolean;
}

export interface StrokeInput {
  tool: StrokeTool;
  points: readonly Point[];
  swatch: number;
  size: number;
  mirror: Mirror;
  options: StrokeOptions;
}

export interface SelectionInput {
  op: SelectionOp;
  rect: { x: number; y: number; w: number; h: number };
  to?: { x: number; y: number };
  rows?: readonly (readonly number[])[];
}

/** Cell index -> swatch index written by an operation. */
export type Writes = Map<number, number>;

/** The line rule: from (x0, y0) to (x1, y1), both ends included. */
export function lineCells(x0: number, y0: number, x1: number, y1: number): Point[] {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x1 > x0 ? 1 : -1;
  const sy = y1 > y0 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  const cells: Point[] = [[x, y]];
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    cells.push([x, y]);
  }
  return cells;
}

/** Successive pointer samples joined in order by the line rule. */
export function joinSamples(points: readonly Point[]): Point[] {
  const first = points[0];
  if (!first) return [];
  const cells: Point[] = [first];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    if (from && to) cells.push(...lineCells(from[0], from[1], to[0], to[1]).slice(1));
  }
  return cells;
}

function collapseRepeats(cells: readonly Point[]): Point[] {
  return cells.filter((cell, i) => {
    const before = cells[i - 1];
    return !before || before[0] !== cell[0] || before[1] !== cell[1];
  });
}

/** Pixel perfect: drop the corner cell of every L-shaped step. */
export function pixelPerfect(path: readonly Point[]): Point[] {
  const kept: Point[] = [];
  for (const c of collapseRepeats(path)) {
    const q = kept[kept.length - 2];
    const p = kept[kept.length - 1];
    if (q && p) {
      const diagonal = Math.abs(q[0] - c[0]) === 1 && Math.abs(q[1] - c[1]) === 1;
      const aligned = (a: Point, b: Point): boolean => a[0] === b[0] || a[1] === b[1];
      if (diagonal && aligned(p, q) && aligned(p, c)) kept.pop();
    }
    kept.push(c);
  }
  return kept;
}

/** Cells of an s by s brush stamp around a path cell. */
export function stampOffsets(size: number): number[] {
  const low = -Math.floor((size - 1) / 2);
  const high = Math.floor(size / 2);
  return Array.from({ length: high - low + 1 }, (_, i) => low + i);
}

export function rectangleCells(a: Point, b: Point, filled: boolean): Point[] {
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  const cells: Point[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (filled || x === x0 || x === x1 || y === y0 || y === y1) cells.push([x, y]);
    }
  }
  return cells;
}

export function ellipseCells(a: Point, b: Point, filled: boolean): Point[] {
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const inside = (x: number, y: number): boolean => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const u = 2 * x + 1 - (x0 + x1 + 1);
    const v = 2 * y + 1 - (y0 + y1 + 1);
    return u * u * h * h + v * v * w * w <= w * w * h * h;
  };
  const cells: Point[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) cells.push([x, y]);
    }
  }
  return cells;
}

/** Every cell the mirror mode paints for a painted cell, the cell itself included. */
export function mirrorCells(cells: readonly Point[], mirror: Mirror, shape: CelShape): Point[] {
  if (mirror === 'none') return [...cells];
  const out: Point[] = [];
  for (const [x, y] of cells) {
    out.push([x, y]);
    if (mirror === 'x' || mirror === 'both') out.push([shape.width - 1 - x, y]);
    if (mirror === 'y' || mirror === 'both') out.push([x, shape.height - 1 - y]);
    if (mirror === 'both') out.push([shape.width - 1 - x, shape.height - 1 - y]);
  }
  return out;
}

const inside = (shape: CelShape, x: number, y: number): boolean => x >= 0 && y >= 0 && x < shape.width && y < shape.height;

/** The fill region: 4-connected on the exact swatch index, or every cell of that index. */
export function fillRegion(cel: Uint8Array, shape: CelShape, seed: Point, contiguous: boolean): number[] {
  const target = cel[seed[1] * shape.width + seed[0]];
  const region: number[] = [];
  if (!contiguous) {
    cel.forEach((value, i) => {
      if (value === target) region.push(i);
    });
    return region;
  }
  const seen = new Uint8Array(cel.length);
  const stack: Point[] = [seed];
  seen[seed[1] * shape.width + seed[0]] = 1;
  while (stack.length > 0) {
    const [x, y] = stack.pop() as Point;
    region.push(y * shape.width + x);
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      const at = ny * shape.width + nx;
      if (inside(shape, nx, ny) && !seen[at] && cel[at] === target) {
        seen[at] = 1;
        stack.push([nx, ny]);
      }
    }
  }
  return region;
}

/** The cells a stroke writes, computed from the cel as it was before the stroke. */
export function strokeWrites(cel: Uint8Array, shape: CelShape, input: StrokeInput): Writes {
  const { tool, points, swatch, size, mirror, options } = input;
  const value = tool === 'eraser' ? 0 : swatch;
  const writes: Writes = new Map();
  if (tool === 'fill' || tool === 'dither') {
    const seed = points[0];
    if (!seed) return writes;
    const level = options.level ?? 8;
    const secondary = options.secondary ?? 0;
    for (const reflected of mirrorCells([seed], mirror, shape)) {
      for (const at of fillRegion(cel, shape, reflected, options.contiguous ?? true)) {
        const x = at % shape.width;
        const y = Math.floor(at / shape.width);
        const matrix = DITHER_MATRIX[y % 4]?.[x % 4] ?? 0;
        writes.set(at, tool === 'fill' || matrix < level ? swatch : secondary);
      }
    }
    return writes;
  }
  let painted: Point[];
  let brush = size;
  const [first, second] = points;
  if (tool === 'line') {
    painted = first && second ? lineCells(first[0], first[1], second[0], second[1]) : [];
  } else if (tool === 'rectangle' || tool === 'ellipse') {
    brush = 1;
    const shapeCells = tool === 'rectangle' ? rectangleCells : ellipseCells;
    painted = first && second ? shapeCells(first, second, options.filled === true) : [];
  } else {
    const path = joinSamples(points);
    painted = options.pixel_perfect === true && size === 1 ? pixelPerfect(path) : path;
  }
  const offsets = stampOffsets(brush);
  const stamped: Point[] = [];
  for (const [x, y] of painted) {
    for (const dy of offsets) for (const dx of offsets) stamped.push([x + dx, y + dy]);
  }
  for (const [x, y] of mirrorCells(stamped, mirror, shape)) {
    if (inside(shape, x, y)) writes.set(y * shape.width + x, value);
  }
  return writes;
}

/** The cells a selection operation writes: move, paste, flips and rotate. */
export function selectionWrites(cel: Uint8Array, shape: CelShape, input: SelectionInput): Writes {
  const { op, rect, to, rows } = input;
  const writes: Writes = new Map();
  const place = (x: number, y: number, value: number): void => {
    if (inside(shape, x, y)) writes.set(y * shape.width + x, value);
  };
  const at = (x: number, y: number): number => cel[y * shape.width + x] ?? 0;
  if (op === 'paste') {
    (rows ?? []).forEach((row, r) =>
      row.forEach((value, c) => {
        if (value !== 0) place((to?.x ?? 0) + c, (to?.y ?? 0) + r, value);
      }),
    );
    return writes;
  }
  const clear = (): void => {
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) writes.set(y * shape.width + x, 0);
  };
  if (op === 'flip_h' || op === 'flip_v') {
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) {
        const sx = op === 'flip_h' ? rect.w - 1 - x : x;
        const sy = op === 'flip_v' ? rect.h - 1 - y : y;
        place(rect.x + x, rect.y + y, at(rect.x + sx, rect.y + sy));
      }
    }
    return writes;
  }
  clear();
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const value = at(rect.x + x, rect.y + y);
      if (value === 0) continue;
      if (op === 'move') place((to?.x ?? 0) + x, (to?.y ?? 0) + y, value);
      else place(rect.x + (rect.h - 1 - y), rect.y + x, value);
    }
  }
  return writes;
}

/** The cells of `writes` that differ from the cel: [cell index, before, after]. */
export function diffWrites(cel: Uint8Array, writes: Writes): [number, number, number][] {
  const diff: [number, number, number][] = [];
  for (const [at, after] of [...writes].sort((a, b) => a[0] - b[0])) {
    const before = cel[at] ?? 0;
    if (before !== after) diff.push([at, before, after]);
  }
  return diff;
}
