// The archipelago: five islands of 24 by 24 tiles, plus the hall room.

export type Tile = readonly [number, number];

export interface Island {
  readonly id: number;
  readonly name: string;
  readonly pond: { x0: number; x1: number; y0: number; y1: number };
  readonly rocks: readonly Tile[];
  readonly lighthouseTile: Tile | null;
}

export const ISLANDS: readonly Island[] = [
  {
    id: 1,
    name: "Saltmarsh Harbour",
    pond: { x0: 15, x1: 17, y0: 3, y1: 5 },
    rocks: [[6, 6], [7, 6], [8, 6], [14, 14], [14, 15], [14, 16]],
    lighthouseTile: null
  },
  {
    id: 2,
    name: "Fernhollow",
    pond: { x0: 4, x1: 6, y0: 15, y1: 17 },
    rocks: [[10, 4], [10, 5], [10, 6], [17, 17], [18, 17], [19, 17]],
    lighthouseTile: null
  },
  {
    id: 3,
    name: "Driftglass Reef",
    pond: { x0: 11, x1: 13, y0: 11, y1: 13 },
    rocks: [[5, 18], [6, 18], [7, 18], [18, 5], [18, 6], [18, 7]],
    lighthouseTile: null
  },
  {
    id: 4,
    name: "Mistcrown Fells",
    pond: { x0: 17, x1: 19, y0: 15, y1: 17 },
    rocks: [[4, 9], [5, 9], [6, 9], [12, 2], [12, 3], [12, 4]],
    lighthouseTile: null
  },
  {
    id: 5,
    name: "Lantern Point",
    pond: { x0: 3, x1: 5, y0: 3, y1: 5 },
    rocks: [[9, 15], [10, 15], [11, 15], [16, 9], [16, 10], [16, 11], [20, 4]],
    lighthouseTile: [20, 4]
  }
];

export const GRID = 24;

export function islandById(id: number): Island | undefined {
  return ISLANDS.find(i => i.id === id);
}

export type Terrain = "land" | "water" | "rock";

/** The single place the terrain of a tile is decided. */
export function terrain(islandId: number, x: number, y: number): Terrain {
  const island = islandById(islandId);
  if (!island) return "water";
  if (x <= 0 || y <= 0 || x >= GRID - 1 || y >= GRID - 1) return "water";
  const p = island.pond;
  if (x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1) return "water";
  if (island.rocks.some(([rx, ry]) => rx === x && ry === y)) return "rock";
  return "land";
}

export function isLand(islandId: number, x: number, y: number): boolean {
  return terrain(islandId, x, y) === "land";
}

/** Spots, the same on every island. */
export const SPOTS: readonly { tile: Tile; heading: Heading }[] = [
  { tile: [3, 12], heading: "E" },
  { tile: [12, 10], heading: "N" },
  { tile: [8, 20], heading: "N" },
  { tile: [20, 12], heading: "W" }
];

export type Heading = "N" | "E" | "S" | "W";

export const HEADINGS: readonly Heading[] = ["N", "E", "S", "W"];

export const HEADING_ANGLE: Record<Heading, number> = { N: 0, E: 90, S: 180, W: 270 };

export function angleOfHeading(h: Heading): number {
  return HEADING_ANGLE[h];
}

export function headingFromAngle(deg: number): Heading {
  const n = ((Math.round(deg) % 360) + 360) % 360;
  return HEADINGS[Math.round(n / 90) % 4];
}

/** The hall room: 6 by 14 floor tiles, walls beyond. */
export const HALL_W = 6;
export const HALL_H = 14;

export function isHallFloor(x: number, y: number): boolean {
  return x >= 0 && x < HALL_W && y >= 0 && y < HALL_H;
}
