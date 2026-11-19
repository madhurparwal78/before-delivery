export type Facing = 'north' | 'east' | 'south' | 'west';
export const FACINGS: readonly Facing[] = ['north', 'east', 'south', 'west'];

export interface Tile {
  x: number;
  y: number;
}

export interface NamedTile extends Tile {
  id: string;
}

export interface Layout {
  width: number;
  height: number;
  spawn: Tile[];
  walls: Tile[];
  seats: NamedTile[];
  exits: NamedTile[];
}

export function isFacing(value: unknown): value is Facing {
  return typeof value === 'string' && (FACINGS as readonly string[]).includes(value);
}

const tileKeyOf = (tile: Tile): string => `${tile.x},${tile.y}`;

function readTile(value: unknown, width: number, height: number): Tile | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const x = record['x'];
  const y = record['y'];
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  const tile = { x: x as number, y: y as number };
  if (tile.x < 0 || tile.y < 0 || tile.x >= width || tile.y >= height) return null;
  return tile;
}

function readNamedTile(value: unknown, width: number, height: number): NamedTile | null {
  const tile = readTile(value, width, height);
  if (tile === null) return null;
  const id = (value as Record<string, unknown>)['id'];
  if (typeof id !== 'string' || id.length === 0) return null;
  return { id, x: tile.x, y: tile.y };
}

export function parseLayout(value: unknown): Layout | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const width = record['width'];
  const height = record['height'];
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if ((width as number) < 4 || (width as number) > 40 || (height as number) < 4 || (height as number) > 40) return null;
  const grid = { width: width as number, height: height as number };

  const spawnRaw = record['spawn'];
  const wallsRaw = record['walls'] ?? [];
  const seatsRaw = record['seats'] ?? [];
  const exitsRaw = record['exits'] ?? [];
  if (!Array.isArray(spawnRaw) || !Array.isArray(wallsRaw) || !Array.isArray(seatsRaw) || !Array.isArray(exitsRaw)) {
    return null;
  }
  const spawn: Tile[] = [];
  for (const entry of spawnRaw) {
    const tile = readTile(entry, grid.width, grid.height);
    if (tile === null) return null;
    spawn.push(tile);
  }
  if (spawn.length === 0) return null;
  const walls: Tile[] = [];
  for (const entry of wallsRaw) {
    const tile = readTile(entry, grid.width, grid.height);
    if (tile === null) return null;
    walls.push(tile);
  }
  const seats: NamedTile[] = [];
  for (const entry of seatsRaw) {
    const tile = readNamedTile(entry, grid.width, grid.height);
    if (tile === null) return null;
    seats.push(tile);
  }
  const exits: NamedTile[] = [];
  for (const entry of exitsRaw) {
    const tile = readNamedTile(entry, grid.width, grid.height);
    if (tile === null) return null;
    exits.push(tile);
  }
  const occupied = new Set<string>();
  for (const tile of [...spawn, ...walls, ...seats, ...exits]) {
    const key = tileKeyOf(tile);
    if (occupied.has(key)) return null;
    occupied.add(key);
  }
  const ids = new Set<string>();
  for (const feature of [...seats, ...exits]) {
    if (ids.has(feature.id)) return null;
    ids.add(feature.id);
  }
  return { width: grid.width, height: grid.height, spawn, walls, seats, exits };
}

export type TileKind = 'outside' | 'wall' | 'seat' | 'exit' | 'floor';

export function tileKind(layout: Layout, tile: Tile): TileKind {
  if (tile.x < 0 || tile.y < 0 || tile.x >= layout.width || tile.y >= layout.height) return 'outside';
  if (layout.walls.some((wall) => wall.x === tile.x && wall.y === tile.y)) return 'wall';
  if (layout.seats.some((seat) => seat.x === tile.x && seat.y === tile.y)) return 'seat';
  if (layout.exits.some((exit) => exit.x === tile.x && exit.y === tile.y)) return 'exit';
  return 'floor';
}

export function tileAhead(tile: Tile, facing: Facing): Tile {
  if (facing === 'north') return { x: tile.x, y: tile.y - 1 };
  if (facing === 'south') return { x: tile.x, y: tile.y + 1 };
  if (facing === 'east') return { x: tile.x + 1, y: tile.y };
  return { x: tile.x - 1, y: tile.y };
}

export function joinCandidates(layout: Layout): Tile[] {
  const candidates = [...layout.spawn];
  const seen = new Set(candidates.map(tileKeyOf));
  for (let y = 0; y < layout.height; y += 1) {
    for (let x = 0; x < layout.width; x += 1) {
      const tile = { x, y };
      if (seen.has(tileKeyOf(tile))) continue;
      if (tileKind(layout, tile) !== 'floor') continue;
      candidates.push(tile);
      seen.add(tileKeyOf(tile));
    }
  }
  return candidates;
}

export function standCandidates(layout: Layout, seat: Tile, satFrom: Tile | null): Tile[] {
  const candidates: Tile[] = [];
  if (satFrom !== null) candidates.push(satFrom);
  for (const facing of FACINGS) {
    const tile = tileAhead(seat, facing);
    if (!candidates.some((entry) => entry.x === tile.x && entry.y === tile.y)) candidates.push(tile);
  }
  return candidates.filter((tile) => tileKind(layout, tile) === 'floor');
}
