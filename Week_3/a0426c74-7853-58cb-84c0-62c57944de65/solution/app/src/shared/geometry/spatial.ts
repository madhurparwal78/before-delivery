// A uniform grid over bounding boxes: rectangle queries touch only the cells they cover, so snaps, picks, windows and Find stay far below 10 ms at 10 000 entities.
import type { Rect } from '../types.ts';
import { rectsMeet } from './curves.ts';

interface Boxed { bounds: Rect }

const COORD_LIMIT = 2 ** 20;
/** Items covering more cells than this are kept in a short list that every query scans. */
const MAX_CELLS_PER_ITEM = 64;

export class GridIndex<T extends Boxed> {
  private readonly cells = new Map<number, Set<T>>();
  private readonly large = new Set<T>();
  private readonly all = new Set<T>();

  constructor(private readonly cell: number) {}

  /** A cell size from the items' typical extent, so most items cover one to four cells. */
  static cellSizeFor(items: readonly Boxed[]): number {
    if (items.length === 0) return 1;
    const sizes = items.map(({ bounds }) => Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1])).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)];
    return Math.max(median * 2, sizes[sizes.length - 1] / 512, 1e-3);
  }

  private column(x: number): number {
    return Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, Math.floor(x / this.cell)));
  }

  private key(cx: number, cy: number): number {
    return (cx + COORD_LIMIT) * (2 * COORD_LIMIT + 1) + (cy + COORD_LIMIT);
  }

  private span(bounds: Rect): [number, number, number, number] {
    return [this.column(bounds[0]), this.column(bounds[1]), this.column(bounds[2]), this.column(bounds[3])];
  }

  insert(item: T): void {
    this.all.add(item);
    const [x1, y1, x2, y2] = this.span(item.bounds);
    if ((x2 - x1 + 1) * (y2 - y1 + 1) > MAX_CELLS_PER_ITEM) {
      this.large.add(item);
      return;
    }
    for (let cx = x1; cx <= x2; cx++) {
      for (let cy = y1; cy <= y2; cy++) {
        const key = this.key(cx, cy);
        const bucket = this.cells.get(key);
        if (bucket === undefined) this.cells.set(key, new Set([item]));
        else bucket.add(item);
      }
    }
  }

  remove(item: T): void {
    this.all.delete(item);
    if (this.large.delete(item)) return;
    const [x1, y1, x2, y2] = this.span(item.bounds);
    for (let cx = x1; cx <= x2; cx++) {
      for (let cy = y1; cy <= y2; cy++) {
        const key = this.key(cx, cy);
        const bucket = this.cells.get(key);
        if (bucket?.delete(item) === true && bucket.size === 0) this.cells.delete(key);
      }
    }
  }

  /** Items whose bounding box meets `rect`. */
  query(rect: Rect): T[] {
    const [x1, y1, x2, y2] = this.span(rect);
    const covered = (x2 - x1 + 1) * (y2 - y1 + 1);
    const found = new Set<T>();
    if (covered > this.all.size) {
      for (const item of this.all) if (rectsMeet(item.bounds, rect)) found.add(item);
      return [...found];
    }
    for (let cx = x1; cx <= x2; cx++) {
      for (let cy = y1; cy <= y2; cy++) {
        for (const item of this.cells.get(this.key(cx, cy)) ?? []) if (rectsMeet(item.bounds, rect)) found.add(item);
      }
    }
    for (const item of this.large) if (rectsMeet(item.bounds, rect)) found.add(item);
    return [...found];
  }
}
