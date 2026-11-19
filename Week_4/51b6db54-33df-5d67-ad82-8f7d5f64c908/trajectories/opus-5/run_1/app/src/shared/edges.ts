import type { TileCell } from './types.js';

export const EDGE_N = 1;
export const EDGE_E = 2;
export const EDGE_S = 4;
export const EDGE_W = 8;

export function defaultEdgeTable(): number[] {
  return Array.from({ length: 16 }, (_unused, mask) => mask + 1);
}

export type MapCells = Map<string, TileCell>;

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function filled(cells: MapCells, x: number, y: number, width: number, height: number): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  const cell = cells.get(cellKey(x, y));
  return cell !== undefined && cell.tile !== 0;
}

export function edgeMask(
  cells: MapCells,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  let mask = 0;
  if (filled(cells, x, y - 1, width, height)) mask |= EDGE_N;
  if (filled(cells, x + 1, y, width, height)) mask |= EDGE_E;
  if (filled(cells, x, y + 1, width, height)) mask |= EDGE_S;
  if (filled(cells, x - 1, y, width, height)) mask |= EDGE_W;
  return mask;
}

export interface EdgeChange {
  x: number;
  y: number;
  tile: number;
  flip_h: boolean;
  flip_v: boolean;
  mask: number | null;
}

/**
 * Placing or erasing with edge matching on: the cell and its four neighbours,
 * each filled one taking table[mask] with cleared flips.
 */
export function edgeMatchedChanges(
  cells: MapCells,
  x: number,
  y: number,
  tile: number,
  table: number[],
  width: number,
  height: number,
): EdgeChange[] {
  const next: MapCells = new Map(cells);
  if (tile === 0) next.delete(cellKey(x, y));
  else next.set(cellKey(x, y), { tile, flip_h: false, flip_v: false });

  const touched: { x: number; y: number }[] = [
    { x, y },
    { x, y: y - 1 },
    { x: x + 1, y },
    { x, y: y + 1 },
    { x: x - 1, y },
  ];
  const changes: EdgeChange[] = [];
  for (const spot of touched) {
    if (spot.x < 0 || spot.y < 0 || spot.x >= width || spot.y >= height) continue;
    const isFilled = filled(next, spot.x, spot.y, width, height);
    const mask = edgeMask(next, spot.x, spot.y, width, height);
    if (!isFilled) {
      if (spot.x === x && spot.y === y && tile === 0) {
        changes.push({ x: spot.x, y: spot.y, tile: 0, flip_h: false, flip_v: false, mask });
      }
      continue;
    }
    changes.push({
      x: spot.x,
      y: spot.y,
      tile: table[mask],
      flip_h: false,
      flip_v: false,
      mask,
    });
  }
  changes.sort((l, r) => (l.y === r.y ? l.x - r.x : l.y - r.y));
  return changes;
}

export function flipTileRows(rows: number[][], flipH: boolean, flipV: boolean): number[][] {
  let out = rows.map((row) => [...row]);
  if (flipH) out = out.map((row) => [...row].reverse());
  if (flipV) out = [...out].reverse();
  return out;
}
