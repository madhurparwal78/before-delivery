import type { PoolClient } from 'pg';
import type { Surface, TileCell } from '../shared/types.js';
import { now } from './clock.js';
import { config } from './config.js';
import { first, rows, transact } from './db.js';
import type { SpriteRow } from './access.js';
import type { Person } from './http.js';
import { publishProject, publishSprite, type LiveEvent } from './live.js';
import { readBuffer, spriteById, writeBuffer } from './sprite.js';

export interface CelPatch {
  buffer: number;
  offsets: number[];
  before: number[];
  after: number[];
}

export interface SwatchPatch {
  palette: number;
  index: number;
  before: { color: string; version: number; present: boolean } | null;
  after: { color: string; version: number; present: boolean } | null;
}

export interface MapCellPatch {
  x: number;
  y: number;
  before: TileCell | null;
  after: TileCell | null;
}

export interface MapPatch {
  tilemap: number;
  cells: MapCellPatch[];
}

export interface Patch {
  cels?: CelPatch[];
  swatch?: SwatchPatch;
  map?: MapPatch;
}

export interface OpContext {
  client: PoolClient;
  sprite: SpriteRow;
  person: Person;
  at: Date;
  events: LiveEvent[];
}

export interface OpInput {
  type: string;
  data?: Record<string, unknown>;
  patch?: Patch;
  undoable?: boolean;
  clientStrokeId?: string;
  response?: unknown;
}

/** Every sprite operation is sequenced inside one locked transaction. */
export async function spriteTransaction<T>(
  spriteId: number,
  person: Person,
  work: (ctx: OpContext) => Promise<T>,
): Promise<T> {
  const at = await now();
  const { result, events, projectId } = await transact(async (client) => {
    await client.query('SELECT id FROM sprites WHERE id = $1 FOR UPDATE', [spriteId]);
    const sprite = await spriteById(client, spriteId);
    const ctx: OpContext = { client, sprite, person, at, events: [] };
    const value = await work(ctx);
    return { result: value, events: ctx.events, projectId: sprite.project_id };
  });
  for (const event of events) {
    if (event.type === 'activity') publishProject(projectId, event);
    else publishSprite(spriteId, event);
  }
  return result;
}

export async function recordOperation(ctx: OpContext, input: OpInput): Promise<number> {
  const bumped = await first<{ seq: number }>(
    ctx.client,
    'UPDATE sprites SET seq = seq + 1 WHERE id = $1 RETURNING seq',
    [ctx.sprite.id],
  );
  const seq = (bumped as { seq: number }).seq;
  ctx.sprite.seq = seq;
  const undoable = input.undoable === true;
  if (undoable) {
    await ctx.client.query(
      `UPDATE operations SET stack_state = 'dropped'
        WHERE sprite_id = $1 AND by_user_id = $2 AND stack_state = 'undone'`,
      [ctx.sprite.id, ctx.person.id],
    );
  }
  await ctx.client.query(
    `INSERT INTO operations
       (sprite_id, seq, type, by_user_id, by_name, at, data, patch, undoable, stack_state, client_stroke_id, response)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      ctx.sprite.id,
      seq,
      input.type,
      ctx.person.id,
      ctx.person.name,
      ctx.at,
      JSON.stringify({ ...(input.data ?? {}), by: ctx.person.name }),
      input.patch === undefined ? null : JSON.stringify(input.patch),
      undoable,
      undoable ? 'active' : 'none',
      input.clientStrokeId ?? null,
      input.response === undefined ? null : JSON.stringify(input.response),
    ],
  );
  if (undoable) await dropBeyondDepth(ctx);
  return seq;
}

async function dropBeyondDepth(ctx: OpContext): Promise<void> {
  await ctx.client.query(
    `UPDATE operations SET stack_state = 'dropped'
      WHERE id IN (
        SELECT id FROM operations
         WHERE sprite_id = $1 AND by_user_id = $2 AND stack_state = 'active'
         ORDER BY seq DESC OFFSET $3
      )`,
    [ctx.sprite.id, ctx.person.id, config.undoDepth],
  );
}

export async function clearStacks(ctx: OpContext): Promise<void> {
  await ctx.client.query(
    `UPDATE operations SET stack_state = 'dropped'
      WHERE sprite_id = $1 AND stack_state IN ('active', 'undone')`,
    [ctx.sprite.id],
  );
}

export interface CelWrite {
  bufferId: number;
  surface: Surface;
  writes: Map<number, number>;
}

/** Applies writes to a cel buffer and returns the patch that can undo them. */
export async function applyCelWrites(
  ctx: OpContext,
  write: CelWrite,
): Promise<{ patch: CelPatch; changed: number }> {
  const offsets: number[] = [];
  const before: number[] = [];
  const after: number[] = [];
  let changed = 0;
  for (const [offset, index] of [...write.writes].sort((l, r) => l[0] - r[0])) {
    const old = write.surface.indices[offset];
    offsets.push(offset);
    before.push(old);
    after.push(index);
    if (old !== index) changed += 1;
    write.surface.indices[offset] = index;
  }
  await writeBuffer(ctx.client, write.bufferId, write.surface);
  return { patch: { buffer: write.bufferId, offsets, before, after }, changed };
}

export async function applyCelPatch(
  client: PoolClient,
  sprite: SpriteRow,
  patch: CelPatch,
  direction: 'before' | 'after',
): Promise<number> {
  const surface = await readBuffer(client, patch.buffer, sprite.width, sprite.height);
  const values = direction === 'before' ? patch.before : patch.after;
  let changed = 0;
  patch.offsets.forEach((offset, at) => {
    if (surface.indices[offset] !== values[at]) changed += 1;
    surface.indices[offset] = values[at];
  });
  await writeBuffer(client, patch.buffer, surface);
  return changed;
}

export interface UndoTarget {
  id: number;
  seq: number;
  type: string;
  patch: Patch;
  data: Record<string, unknown>;
}

export async function stackTop(
  ctx: OpContext,
  state: 'active' | 'undone',
): Promise<UndoTarget | null> {
  return first<UndoTarget>(
    ctx.client,
    `SELECT id, seq, type, patch, data FROM operations
      WHERE sprite_id = $1 AND by_user_id = $2 AND stack_state = $3 AND undoable
      ORDER BY seq DESC LIMIT 1`,
    [ctx.sprite.id, ctx.person.id, state],
  );
}

function touchesCels(patch: Patch): Map<number, Set<number>> {
  const map = new Map<number, Set<number>>();
  for (const cel of patch.cels ?? []) {
    const set = map.get(cel.buffer) ?? new Set<number>();
    for (const offset of cel.offsets) set.add(offset);
    map.set(cel.buffer, set);
  }
  return map;
}

/** The most recent other person who changed anything this operation touched. */
export async function conflictingPerson(
  ctx: OpContext,
  target: UndoTarget,
): Promise<string | null> {
  const later = await rows<{ by_name: string; patch: Patch | null }>(
    ctx.client,
    `SELECT by_name, patch FROM operations
      WHERE sprite_id = $1 AND seq > $2 AND (by_user_id IS NULL OR by_user_id <> $3)
      ORDER BY seq DESC`,
    [ctx.sprite.id, target.seq, ctx.person.id],
  );
  const cels = touchesCels(target.patch);
  const swatchIndex = target.patch.swatch?.index ?? null;
  const mapCells = new Set(
    (target.patch.map?.cells ?? []).map((cell) => `${target.patch.map?.tilemap}:${cell.x},${cell.y}`),
  );
  for (const op of later) {
    if (op.patch === null) continue;
    for (const cel of op.patch.cels ?? []) {
      const set = cels.get(cel.buffer);
      if (set === undefined) continue;
      if (cel.offsets.some((offset) => set.has(offset))) return op.by_name;
    }
    if (swatchIndex !== null && op.patch.swatch?.index === swatchIndex) return op.by_name;
    for (const cell of op.patch.map?.cells ?? []) {
      if (mapCells.has(`${op.patch.map?.tilemap}:${cell.x},${cell.y}`)) return op.by_name;
    }
  }
  return null;
}

export async function replayedResponse(
  client: PoolClient,
  spriteId: number,
  personId: number,
  clientStrokeId: string,
): Promise<unknown | null> {
  const stored = await first<{ response: unknown }>(
    client,
    `SELECT response FROM operations
      WHERE sprite_id = $1 AND by_user_id = $2 AND client_stroke_id = $3
      ORDER BY seq LIMIT 1`,
    [spriteId, personId, clientStrokeId],
  );
  return stored === null ? null : stored.response;
}
