// The tile grid: layouts, facing, steps and seats. Every domain rule about
// walking lives here.
export interface LayoutFeature {
  id: string;
  x: number;
  y: number;
}
export interface Layout {
  width: number;
  height: number;
  spawn: { x: number; y: number }[];
  walls: { x: number; y: number }[];
  seats: (LayoutFeature & {})[];
  exits: (LayoutFeature & {})[];
}

export type Facing = 'north' | 'east' | 'south' | 'west';
export const FACINGS: Facing[] = ['north', 'east', 'south', 'west'];
export const DIRECTIONS: Facing[] = ['north', 'east', 'south', 'west'];

export interface Tile {
  x: number;
  y: number;
}

export const WALL_TEXT = 'A wall blocks that way.';
export const SEAT_TEXT = 'A seat blocks that way.';
export const PERSON_TEXT = 'Someone is standing there.';
export const SEATED_TEXT = 'Stand up to move.';

export function parseLayout(value: unknown): Layout | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.width !== 'number' || typeof v.height !== 'number') return null;
  if (!Array.isArray(v.spawn) || !Array.isArray(v.walls) || !Array.isArray(v.seats) || !Array.isArray(v.exits)) return null;
  const inside = (t: unknown): t is Tile =>
    typeof t === 'object' && t !== null && typeof (t as Tile).x === 'number' && typeof (t as Tile).y === 'number';
  if (v.width < 4 || v.width > 40 || v.height < 4 || v.height > 40) return null;
  if (!v.spawn.every(inside)) return null;
  const layout: Layout = {
    width: Math.floor(v.width),
    height: Math.floor(v.height),
    spawn: v.spawn.map((t) => ({ x: (t as Tile).x, y: (t as Tile).y })),
    walls: v.walls.filter(inside).map((t) => ({ x: (t as Tile).x, y: (t as Tile).y })),
    seats: [],
    exits: [],
  };
  const seatIds = new Set<string>();
  const exitIds = new Set<string>();
  for (const s of v.seats) {
    if (!inside(s) || typeof (s as LayoutFeature).id !== 'string') return null;
    const id = (s as LayoutFeature).id;
    if (seatIds.has(id)) return null;
    seatIds.add(id);
    layout.seats.push({ id, x: s.x, y: s.y });
  }
  for (const e of v.exits) {
    if (!inside(e) || typeof (e as LayoutFeature).id !== 'string') return null;
    const id = (e as LayoutFeature).id;
    if (exitIds.has(id)) return null;
    exitIds.add(id);
    layout.exits.push({ id, x: e.x, y: e.y });
  }
  // Every spawn, wall, seat and exit inside the grid; no two share a tile.
  const tiles = new Set<string>();
  const all = [
    ...layout.spawn.map((t) => ({ ...t })),
    ...layout.walls,
    ...layout.seats,
    ...layout.exits,
  ];
  for (const t of all) {
    if (t.x < 0 || t.y < 0 || t.x >= layout.width || t.y >= layout.height) return null;
    const k = `${t.x},${t.y}`;
    if (tiles.has(k)) return null;
    tiles.add(k);
  }
  if (layout.spawn.length === 0) return null;
  return layout;
}

export function layoutAt(layout: Layout, x: number, y: number): 'wall' | 'seat' | 'exit' | 'floor' {
  if (layout.walls.some((w) => w.x === x && w.y === y)) return 'wall';
  if (layout.seats.some((s) => s.x === x && s.y === y)) return 'seat';
  if (layout.exits.some((e) => e.x === x && e.y === y)) return 'exit';
  return 'floor';
}

export function tileDelta(direction: Facing): Tile {
  switch (direction) {
    case 'north': return { x: 0, y: -1 };
    case 'east': return { x: 1, y: 0 };
    case 'south': return { x: 0, y: 1 };
    case 'west': return { x: -1, y: 0 };
  }
}

export function stepFrom(t: Tile, direction: Facing): Tile {
  const d = tileDelta(direction);
  return { x: t.x + d.x, y: t.y + d.y };
}

export function insideGrid(layout: Layout, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < layout.width && y < layout.height;
}

export function chebyshev(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export const CHAT_DISTANCE = 6;

export function withinChatDistance(a: Tile, b: Tile): boolean {
  return chebyshev(a, b) <= CHAT_DISTANCE;
}

export function seatAhead(layout: Layout, t: Tile, facing: Facing): LayoutFeature | null {
  const ahead = stepFrom(t, facing);
  return layout.seats.find((s) => s.x === ahead.x && s.y === ahead.y) ?? null;
}
