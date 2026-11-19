import type { MirrorMode, Point, StrokeOptions, StrokeTool, Surface } from './types.js';

export const DITHER_MATRIX: number[][] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** The published line rule, from (x0,y0) to (x1,y1) inclusive. */
export function linePoints(x0: number, y0: number, x1: number, y1: number): Point[] {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  const out: Point[] = [];
  for (;;) {
    out.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/** Successive samples joined in order by the line rule, repeated cells collapsed. */
export function joinSamples(samples: Point[]): Point[] {
  const out: Point[] = [];
  const push = (point: Point): void => {
    const last = out[out.length - 1];
    if (last && last.x === point.x && last.y === point.y) return;
    out.push(point);
  };
  if (samples.length === 0) return out;
  push(samples[0]);
  for (let i = 1; i < samples.length; i += 1) {
    const from = samples[i - 1];
    const to = samples[i];
    for (const point of linePoints(from.x, from.y, to.x, to.y)) push(point);
  }
  return out;
}

/** Offsets covered by a brush of size s, from -floor((s-1)/2) to floor(s/2). */
export function brushOffsets(size: number): number[] {
  const out: number[] = [];
  for (let d = -Math.floor((size - 1) / 2); d <= Math.floor(size / 2); d += 1) out.push(d);
  return out;
}

export function brushCells(centre: Point, size: number): Point[] {
  const offsets = brushOffsets(size);
  const out: Point[] = [];
  for (const dy of offsets) for (const dx of offsets) out.push({ x: centre.x + dx, y: centre.y + dy });
  return out;
}

export function rectangleCells(a: Point, b: Point, filled: boolean): Point[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const out: Point[] = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (filled || x === x0 || x === x1 || y === y0 || y === y1) out.push({ x, y });
    }
  }
  return out;
}

function ellipseInside(a: Point, b: Point): (x: number, y: number) => boolean {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  return (x: number, y: number): boolean => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const u = 2 * x + 1 - (x0 + x1 + 1);
    const v = 2 * y + 1 - (y0 + y1 + 1);
    return u * u * h * h + v * v * w * w <= w * w * h * h;
  };
}

export function ellipseCells(a: Point, b: Point, filled: boolean): Point[] {
  const inside = ellipseInside(a, b);
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const out: Point[] = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (!inside(x, y)) continue;
      if (filled) {
        out.push({ x, y });
        continue;
      }
      const edge =
        !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      if (edge) out.push({ x, y });
    }
  }
  return out;
}

/** Cells of the fill region, 4-connected on exact swatch index, or every cell of that index. */
export function fillRegion(surface: Surface, seed: Point, contiguous: boolean): Point[] {
  const { width, height, indices } = surface;
  if (seed.x < 0 || seed.y < 0 || seed.x >= width || seed.y >= height) return [];
  const target = indices[seed.y * width + seed.x];
  const out: Point[] = [];
  if (!contiguous) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) if (indices[y * width + x] === target) out.push({ x, y });
    }
    return out;
  }
  const seen = new Uint8Array(width * height);
  const queue: number[] = [seed.y * width + seed.x];
  seen[queue[0]] = 1;
  while (queue.length > 0) {
    const cell = queue.pop() as number;
    const x = cell % width;
    const y = (cell - x) / width;
    out.push({ x, y });
    const neighbours: Point[] = [
      { x, y: y - 1 },
      { x: x + 1, y },
      { x, y: y + 1 },
      { x: x - 1, y },
    ];
    for (const next of neighbours) {
      if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) continue;
      const offset = next.y * width + next.x;
      if (seen[offset] === 1 || indices[offset] !== target) continue;
      seen[offset] = 1;
      queue.push(offset);
    }
  }
  out.sort((l, r) => (l.y === r.y ? l.x - r.x : l.y - r.y));
  return out;
}

export function mirrorCells(cell: Point, mirror: MirrorMode, width: number, height: number): Point[] {
  const out: Point[] = [cell];
  const mx = { x: width - 1 - cell.x, y: cell.y };
  const my = { x: cell.x, y: height - 1 - cell.y };
  const both = { x: width - 1 - cell.x, y: height - 1 - cell.y };
  if (mirror === 'x' || mirror === 'both') out.push(mx);
  if (mirror === 'y' || mirror === 'both') out.push(my);
  if (mirror === 'both') out.push(both);
  return out;
}

/** The pixel perfect rule: drop the corner cell between two diagonal neighbours. */
export function pixelPerfect(path: Point[]): Point[] {
  const kept: Point[] = [];
  for (const c of path) {
    if (kept.length >= 2) {
      const q = kept[kept.length - 2];
      const p = kept[kept.length - 1];
      const diagonal = Math.abs(q.x - c.x) === 1 && Math.abs(q.y - c.y) === 1;
      const sharesWithQ = p.x === q.x || p.y === q.y;
      const sharesWithC = p.x === c.x || p.y === c.y;
      if (diagonal && sharesWithQ && sharesWithC) kept.pop();
    }
    kept.push(c);
  }
  return kept;
}

export interface StrokeShape {
  tool: StrokeTool;
  points: Point[];
  swatch: number;
  size: number;
  mirror: MirrorMode;
  options: StrokeOptions;
}

/** Every cell a stroke writes, as cel offset to new swatch index. */
export function strokeWrites(shape: StrokeShape, surface: Surface): Map<number, number> {
  const { width, height } = surface;
  const writes = new Map<number, number>();
  const put = (cell: Point, index: number): void => {
    if (cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= height) return;
    writes.set(cell.y * width + cell.x, index);
  };
  const stamp = (cells: Point[], index: number, size: number): void => {
    for (const cell of cells) {
      for (const reflected of mirrorCells(cell, shape.mirror, width, height)) {
        for (const covered of brushCells(reflected, size)) put(covered, index);
      }
    }
  };

  const { tool, points, options } = shape;
  const paintIndex = tool === 'eraser' ? 0 : shape.swatch;

  if (tool === 'pencil' || tool === 'eraser') {
    let path = joinSamples(points);
    if (options.pixel_perfect === true && shape.size === 1) path = pixelPerfect(path);
    stamp(path, paintIndex, shape.size);
    return writes;
  }
  if (tool === 'line') {
    const [a, b] = [points[0], points[points.length - 1]];
    stamp(linePoints(a.x, a.y, b.x, b.y), paintIndex, shape.size);
    return writes;
  }
  if (tool === 'rectangle' || tool === 'ellipse') {
    const [a, b] = [points[0], points[points.length - 1]];
    const cells =
      tool === 'rectangle'
        ? rectangleCells(a, b, options.filled === true)
        : ellipseCells(a, b, options.filled === true);
    stamp(cells, paintIndex, 1);
    return writes;
  }

  const contiguous = options.contiguous !== false;
  const seeds = mirrorCells(points[0], shape.mirror, width, height);
  const seen = new Set<number>();
  for (const seed of seeds) {
    const key = seed.y * width + seed.x;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const cell of fillRegion(surface, seed, contiguous)) {
      if (tool === 'fill') {
        put(cell, shape.swatch);
      } else {
        const value = DITHER_MATRIX[cell.y % 4][cell.x % 4];
        const level = options.level ?? 8;
        put(cell, value < level ? shape.swatch : options.secondary ?? 0);
      }
    }
  }
  return writes;
}
