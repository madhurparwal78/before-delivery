import { EDGE_E, EDGE_N, EDGE_S, EDGE_W } from './rules';

export interface MapCell {
  x: number;
  y: number;
  tile: number;
  flip_h: boolean;
  flip_v: boolean;
}

export type TileRows = number[][];

export function flipRows(rows: readonly (readonly number[])[], horizontal: boolean, vertical: boolean): TileRows {
  const ordered = vertical ? [...rows].reverse() : [...rows];
  return ordered.map((row) => (horizontal ? [...row].reverse() : [...row]));
}

const sameRows = (a: readonly (readonly number[])[], b: readonly (readonly number[])[]): boolean =>
  a.every((row, y) => row.every((value, x) => value === b[y]?.[x]));

/** Cuts a cel into tile-sized blocks, left to right, top to bottom, reusing identical or flipped tiles. */
export function cutTiles(
  cel: Uint8Array,
  width: number,
  height: number,
  tileSize: number,
  existing: readonly TileRows[],
): { tiles: TileRows[]; cells: MapCell[] } {
  const tiles = existing.map((rows) => rows.map((row) => [...row]));
  const cells: MapCell[] = [];
  for (let by = 0; by + tileSize <= height; by += tileSize) {
    for (let bx = 0; bx + tileSize <= width; bx += tileSize) {
      const block: TileRows = Array.from({ length: tileSize }, (_, y) =>
        Array.from({ length: tileSize }, (_, x) => cel[(by + y) * width + bx + x] ?? 0),
      );
      const x = bx / tileSize;
      const y = by / tileSize;
      if (block.every((row) => row.every((value) => value === 0))) {
        cells.push({ x, y, tile: 0, flip_h: false, flip_v: false });
        continue;
      }
      let found: MapCell | undefined;
      for (const [flipH, flipV] of [[false, false], [true, false], [false, true], [true, true]] as const) {
        const index = tiles.findIndex((tile) => sameRows(flipRows(tile, flipH, flipV), block));
        if (index >= 0) {
          found = { x, y, tile: index + 1, flip_h: flipH, flip_v: flipV };
          break;
        }
      }
      if (!found) {
        tiles.push(block);
        found = { x, y, tile: tiles.length, flip_h: false, flip_v: false };
      }
      cells.push(found);
    }
  }
  return { tiles, cells };
}

/** The mask of filled neighbours of a map cell; cells beyond the map are not filled. */
export function edgeMask(filled: (x: number, y: number) => boolean, x: number, y: number): number {
  return (filled(x, y - 1) ? EDGE_N : 0) | (filled(x + 1, y) ? EDGE_E : 0) | (filled(x, y + 1) ? EDGE_S : 0) | (filled(x - 1, y) ? EDGE_W : 0);
}

export interface EdgeUpdate {
  x: number;
  y: number;
  tile: number;
  mask: number;
}

/** Placing or erasing at (x, y): the cell and its four neighbours that are filled afterwards take table[mask]. */
export function edgeUpdates(
  map: ReadonlyMap<string, number>,
  width: number,
  height: number,
  x: number,
  y: number,
  erase: boolean,
  table: readonly number[],
): EdgeUpdate[] {
  const key = (cx: number, cy: number): string => `${cx},${cy}`;
  const filled = (cx: number, cy: number): boolean =>
    cx >= 0 && cy >= 0 && cx < width && cy < height && (cx === x && cy === y ? !erase : (map.get(key(cx, cy)) ?? 0) !== 0);
  const updates: EdgeUpdate[] = [];
  for (const [cx, cy] of [[x, y - 1], [x - 1, y], [x, y], [x + 1, y], [x, y + 1]] as const) {
    if (!filled(cx, cy)) continue;
    const mask = edgeMask(filled, cx, cy);
    updates.push({ x: cx, y: cy, tile: table[mask] ?? 0, mask });
  }
  return updates;
}

export interface StampCell {
  tile: number;
  flip_h: boolean;
  flip_v: boolean;
}

/** Mirrors a held stamp's columns (H) or rows (V) and toggles each cell's matching flip. */
export function flipStamp(cells: readonly (readonly StampCell[])[], axis: 'h' | 'v'): StampCell[][] {
  const ordered = axis === 'v' ? [...cells].reverse() : [...cells];
  return ordered.map((row) => {
    const line = axis === 'h' ? [...row].reverse() : [...row];
    return line.map((cell) => (axis === 'h' ? { ...cell, flip_h: !cell.flip_h } : { ...cell, flip_v: !cell.flip_v }));
  });
}
