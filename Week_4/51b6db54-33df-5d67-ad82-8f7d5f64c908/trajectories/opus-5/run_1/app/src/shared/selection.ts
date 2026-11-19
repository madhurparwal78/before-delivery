import type { Point, Rect, SelectionOp, Surface } from './types.js';

export interface SelectionShape {
  op: SelectionOp;
  rect: Rect;
  to?: Point;
  rows?: number[][];
}

export interface SelectionResult {
  writes: Map<number, number>;
  rect: Rect;
}

/** Swatch indices inside a rectangle, read from the cel, outside cells transparent. */
export function readRect(surface: Surface, rect: Rect): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < rect.h; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < rect.w; x += 1) {
      const sx = rect.x + x;
      const sy = rect.y + y;
      const inside = sx >= 0 && sy >= 0 && sx < surface.width && sy < surface.height;
      row.push(inside ? surface.indices[sy * surface.width + sx] : 0);
    }
    rows.push(row);
  }
  return rows;
}

/** Each selection operation as one atomic set of writes, by the published rules. */
export function selectionWrites(shape: SelectionShape, surface: Surface): SelectionResult {
  const { width, height } = surface;
  const writes = new Map<number, number>();
  const put = (x: number, y: number, index: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    writes.set(y * width + x, index);
  };
  const clear = (rect: Rect): void => {
    for (let y = 0; y < rect.h; y += 1) for (let x = 0; x < rect.w; x += 1) put(rect.x + x, rect.y + y, 0);
  };

  const { rect, op } = shape;
  if (op === 'paste') {
    const rows = shape.rows ?? [];
    const to = shape.to ?? { x: rect.x, y: rect.y };
    rows.forEach((row, y) => {
      row.forEach((index, x) => {
        if (index !== 0) put(to.x + x, to.y + y, index);
      });
    });
    return { writes, rect: { x: to.x, y: to.y, w: rows[0]?.length ?? 0, h: rows.length } };
  }

  const source = readRect(surface, rect);

  if (op === 'move') {
    const to = shape.to ?? { x: rect.x, y: rect.y };
    clear(rect);
    source.forEach((row, y) => {
      row.forEach((index, x) => {
        if (index !== 0) put(to.x + x, to.y + y, index);
      });
    });
    return { writes, rect: { x: to.x, y: to.y, w: rect.w, h: rect.h } };
  }

  if (op === 'flip_h' || op === 'flip_v') {
    for (let y = 0; y < rect.h; y += 1) {
      for (let x = 0; x < rect.w; x += 1) {
        const index = op === 'flip_h' ? source[y][rect.w - 1 - x] : source[rect.h - 1 - y][x];
        put(rect.x + x, rect.y + y, index);
      }
    }
    return { writes, rect };
  }

  clear(rect);
  for (let y = 0; y < rect.h; y += 1) {
    for (let x = 0; x < rect.w; x += 1) {
      put(rect.x + rect.h - 1 - y, rect.y + x, source[y][x]);
    }
  }
  return { writes, rect: { x: rect.x, y: rect.y, w: rect.h, h: rect.w } };
}
