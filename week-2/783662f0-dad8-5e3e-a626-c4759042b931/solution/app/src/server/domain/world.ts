import type { PoolClient, QueryResultRow } from 'pg';
import { one, query } from '../db/pool.js';
import { fail } from '../errors.js';
import { etagOf } from '../http/conditional.js';
import {
  type Material,
  PASSABLE,
  type TileCode,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../../shared/domain.js';
import type { WorldObject } from '../../shared/types.js';

export interface WorldRow {
  id: string;
  server_id: string;
  slug: string;
  name: string;
  tiles: string;
  revision: string;
  created_at: Date;
}

interface TablePlacement {
  readonly name: string;
  readonly game: 'chess' | 'four' | 'tricks';
  readonly x: number;
  readonly y: number;
}

export const STARTER_TABLES: readonly TablePlacement[] = [
  { name: 'Oak Chess Table', game: 'chess', x: 12, y: 6 },
  { name: 'Lantern Four Table', game: 'four', x: 16, y: 6 },
  { name: 'Felt Card Table', game: 'tricks', x: 20, y: 6 },
  { name: 'Birch Chess Table', game: 'chess', x: 24, y: 6 },
];

/** The starter layout every world uses. */
export function starterTiles(): string[] {
  const grid: TileCode[][] = Array.from({ length: WORLD_HEIGHT }, () =>
    Array.from({ length: WORLD_WIDTH }, () => '.' as TileCode),
  );
  const put = (x: number, y: number, code: TileCode): void => {
    if (x >= 0 && x < WORLD_WIDTH && y >= 0 && y < WORLD_HEIGHT) grid[y][x] = code;
  };

  for (let x = 0; x < WORLD_WIDTH; x += 1) put(x, 10, '=');
  for (let y = 11; y <= 17; y += 1) put(20, y, '=');
  for (let x = 30; x <= 37; x += 1) put(x, 2, '#');
  for (let y = 18; y <= 23; y += 1) for (let x = 0; x <= 5; x += 1) put(x, y, '~');
  for (let y = 18; y <= 23; y += 1) for (let x = 34; x <= 39; x += 1) put(x, y, 's');
  for (const table of STARTER_TABLES) put(table.x, table.y, 'T');

  return grid.map((row) => row.join(''));
}

const tilesToRows = (packed: string): string[] => {
  const rows: string[] = [];
  for (let y = 0; y < WORLD_HEIGHT; y += 1) {
    rows.push(packed.slice(y * WORLD_WIDTH, (y + 1) * WORLD_WIDTH));
  }
  return rows;
};

export const rowsToTiles = (rows: readonly string[]): string => rows.join('');

export const tileAt = (packed: string, x: number, y: number): TileCode =>
  packed[y * WORLD_WIDTH + x] as TileCode;

const onMap = (x: number, y: number): boolean =>
  x >= 0 && x < WORLD_WIDTH && y >= 0 && y < WORLD_HEIGHT;


/** Within one tile, counting diagonals. */
export const withinOneTile = (ax: number, ay: number, bx: number, by: number): boolean =>
  Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1;

export type Direction = 'north' | 'east' | 'south' | 'west';

/** North lowers y by one. */
export const STEPS: Readonly<Record<Direction, { dx: number; dy: number }>> = {
  north: { dx: 0, dy: -1 },
  east: { dx: 1, dy: 0 },
  south: { dx: 0, dy: 1 },
  west: { dx: -1, dy: 0 },
};

const loadWorld = (serverId: string, slug: string): Promise<WorldRow | null> =>
  one<WorldRow>('SELECT * FROM worlds WHERE server_id = $1 AND slug = $2', [serverId, slug]);

export async function requireWorld(serverId: string, slug: string): Promise<WorldRow> {
  const world = await loadWorld(serverId, slug);
  if (world === null) throw fail('not_found');
  return world;
}

export const worldEtag = (world: WorldRow): string => etagOf('world', world.id, world.revision);

export async function touchWorld(worldId: string, client?: PoolClient): Promise<void> {
  const sql = 'UPDATE worlds SET revision = revision + 1 WHERE id = $1';
  if (client === undefined) await query(sql, [worldId]);
  else await client.query(sql, [worldId]);
}

interface BlockRow {
  x: number;
  y: number;
  material: Material;
}

export const blocksOf = (worldId: string): Promise<BlockRow[]> =>
  query<BlockRow>('SELECT x, y, material FROM blocks WHERE world_id = $1 ORDER BY y, x', [worldId]);

interface VehicleRow {
  id: string;
  server_id: string;
  world_id: string;
  name: string;
  kind: 'car' | 'plane';
  owner_character_id: string;
  x: number;
  y: number;
}

export const vehiclesOf = (worldId: string): Promise<VehicleRow[]> =>
  query<VehicleRow>('SELECT * FROM vehicles WHERE world_id = $1 ORDER BY id', [worldId]);

export async function worldObject(world: WorldRow): Promise<WorldObject> {
  const blocks = await blocksOf(world.id);
  const vehicles = await vehiclesOf(world.id);
  const characters = await query<{ id: string; name: string; x: number; y: number }>(
    'SELECT id, name, x, y FROM characters WHERE world_id = $1 ORDER BY name',
    [world.id],
  );
  const tables = await query<{
    id: string;
    name: string;
    game: 'chess' | 'four' | 'tricks';
    x: number;
    y: number;
    state: WorldObject['tables'][number]['state'];
  }>('SELECT id, name, game, x, y, state FROM game_tables WHERE world_id = $1 ORDER BY x, y', [
    world.id,
  ]);
  return {
    slug: world.slug,
    name: world.name,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    tiles: tilesToRows(world.tiles),
    tables,
    blocks: blocks.map((block) => ({ x: block.x, y: block.y, material: block.material })),
    vehicles: vehicles.map((vehicle) => ({
      id: vehicle.id,
      name: vehicle.name,
      kind: vehicle.kind,
      owner_character_id: vehicle.owner_character_id,
      x: vehicle.x,
      y: vehicle.y,
    })),
    characters,
  };
}

interface Occupancy {
  readonly block: boolean;
  readonly vehicle: boolean;
  readonly character: boolean;
}

export async function occupancyAt(
  worldId: string,
  x: number,
  y: number,
  client?: PoolClient,
): Promise<Occupancy> {
  const run = async <T extends QueryResultRow>(
    sql: string,
    params: readonly unknown[],
  ): Promise<T[]> =>
    client === undefined
      ? await query<T>(sql, params)
      : (await client.query<T>(sql, params as unknown[])).rows;

  const block = await run<{ material: string }>(
    'SELECT material FROM blocks WHERE world_id = $1 AND x = $2 AND y = $3',
    [worldId, x, y],
  );
  const vehicle = await run<{ id: string }>(
    'SELECT id FROM vehicles WHERE world_id = $1 AND x = $2 AND y = $3',
    [worldId, x, y],
  );
  const character = await run<{ id: string }>(
    'SELECT id FROM characters WHERE world_id = $1 AND x = $2 AND y = $3',
    [worldId, x, y],
  );
  return {
    block: block.length > 0,
    vehicle: vehicle.length > 0,
    character: character.length > 0,
  };
}

/**
 * Grass, road, runway and sand are passable. Water, table tiles, tiles with
 * blocks and leaving the map are not.
 */
export async function passable(
  world: WorldRow,
  x: number,
  y: number,
  client?: PoolClient,
): Promise<boolean> {
  if (!onMap(x, y)) return false;
  if (!PASSABLE[tileAt(world.tiles, x, y)]) return false;
  const here = await occupancyAt(world.id, x, y, client);
  return !here.block;
}

/** A car travels along one shortest road path, moving north, east, south or west. */
export function shortestRoadPath(
  tiles: string,
  blocked: ReadonlySet<string>,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Direction[] | null {
  const key = (x: number, y: number): string => `${x},${y}`;
  const order: Direction[] = ['north', 'east', 'south', 'west'];
  const seen = new Set<string>([key(from.x, from.y)]);
  let frontier: { x: number; y: number; path: Direction[] }[] = [{ ...from, path: [] }];

  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      for (const direction of order) {
        const step = STEPS[direction];
        const x = node.x + step.dx;
        const y = node.y + step.dy;
        if (!onMap(x, y) || tileAt(tiles, x, y) !== '=') continue;
        const id = key(x, y);
        if (seen.has(id)) continue;
        if (blocked.has(id) && !(x === to.x && y === to.y)) continue;
        const path = [...node.path, direction];
        if (x === to.x && y === to.y) return path;
        seen.add(id);
        next.push({ x, y, path });
      }
    }
    frontier = next;
  }
  return null;
}

/** A plane flies along x first and then along y. */
export function planePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): Direction[] {
  const steps: Direction[] = [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  for (let i = 0; i < Math.abs(dx); i += 1) steps.push(dx > 0 ? 'east' : 'west');
  for (let i = 0; i < Math.abs(dy); i += 1) steps.push(dy > 0 ? 'south' : 'north');
  return steps;
}

export const STEP_LETTERS: Readonly<Record<Direction, 'N' | 'E' | 'S' | 'W'>> = {
  north: 'N',
  east: 'E',
  south: 'S',
  west: 'W',
};

const LETTER_STEPS: Readonly<Record<string, Direction>> = {
  N: 'north',
  E: 'east',
  S: 'south',
  W: 'west',
};

/** Replay applies only the stored steps to the start tile. */
export function replayTrip(
  from: { x: number; y: number },
  steps: readonly string[],
): { x: number; y: number } {
  let { x, y } = from;
  for (const letter of steps) {
    const direction = LETTER_STEPS[letter];
    if (direction === undefined) continue;
    x += STEPS[direction].dx;
    y += STEPS[direction].dy;
  }
  return { x, y };
}
