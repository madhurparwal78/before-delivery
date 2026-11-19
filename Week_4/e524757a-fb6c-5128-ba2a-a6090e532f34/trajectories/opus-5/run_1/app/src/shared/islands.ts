export type Heading = 'N' | 'E' | 'S' | 'W';
export type Tile = { x: number; y: number };

export const GRID = 24;

export type IslandDef = {
  id: number;
  name: string;
  pond: { x0: number; x1: number; y0: number; y1: number };
  rocks: ReadonlyArray<readonly [number, number]>;
};

export const ISLANDS: ReadonlyArray<IslandDef> = [
  {
    id: 1,
    name: 'Saltmarsh Harbour',
    pond: { x0: 15, x1: 17, y0: 3, y1: 5 },
    rocks: [
      [6, 6],
      [7, 6],
      [8, 6],
      [14, 14],
      [14, 15],
      [14, 16],
    ],
  },
  {
    id: 2,
    name: 'Fernhollow',
    pond: { x0: 4, x1: 6, y0: 15, y1: 17 },
    rocks: [
      [10, 4],
      [10, 5],
      [10, 6],
      [17, 17],
      [18, 17],
      [19, 17],
    ],
  },
  {
    id: 3,
    name: 'Driftglass Reef',
    pond: { x0: 11, x1: 13, y0: 11, y1: 13 },
    rocks: [
      [5, 18],
      [6, 18],
      [7, 18],
      [18, 5],
      [18, 6],
      [18, 7],
    ],
  },
  {
    id: 4,
    name: 'Mistcrown Fells',
    pond: { x0: 17, x1: 19, y0: 15, y1: 17 },
    rocks: [
      [4, 9],
      [5, 9],
      [6, 9],
      [12, 2],
      [12, 3],
      [12, 4],
    ],
  },
  {
    id: 5,
    name: 'Lantern Point',
    pond: { x0: 3, x1: 5, y0: 3, y1: 5 },
    rocks: [
      [9, 15],
      [10, 15],
      [11, 15],
      [16, 9],
      [16, 10],
      [16, 11],
      [20, 4],
    ],
  },
];

export const SPOTS: ReadonlyArray<{ tile: Tile; heading: Heading }> = [
  { tile: { x: 3, y: 12 }, heading: 'E' },
  { tile: { x: 12, y: 10 }, heading: 'N' },
  { tile: { x: 8, y: 20 }, heading: 'N' },
  { tile: { x: 20, y: 12 }, heading: 'W' },
];

export function islandById(id: number): IslandDef {
  const found = ISLANDS.find((i) => i.id === id);
  if (!found) throw new Error(`unknown island ${id}`);
  return found;
}

export function islandName(id: number): string {
  return islandById(id).name;
}

export type TileKind = 'water' | 'rock' | 'land';

export function tileKind(island: number, x: number, y: number): TileKind {
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return 'water';
  const def = islandById(island);
  if (x === 0 || y === 0 || x === GRID - 1 || y === GRID - 1) return 'water';
  const p = def.pond;
  if (x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1) return 'water';
  if (def.rocks.some(([rx, ry]) => rx === x && ry === y)) return 'rock';
  return 'land';
}

export function isLand(island: number, x: number, y: number): boolean {
  return tileKind(island, x, y) === 'land';
}

export const HEADING_ANGLE: Record<Heading, number> = { N: 0, E: 90, S: 180, W: 270 };

export const HEADING_DELTA: Record<Heading, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
};

export const HALL_WIDTH = 6;
export const HALL_DEPTH = 14;
export const HALL_START: Tile = { x: 2, y: 13 };

export function isHallFloor(x: number, y: number): boolean {
  return x >= 0 && x < HALL_WIDTH && y >= 0 && y < HALL_DEPTH;
}
