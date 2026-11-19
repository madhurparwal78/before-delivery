import { q, one } from './db.js';
import { now } from './clock.js';
import { ApiError, notFound, fieldErrors } from './errors.js';
import { formatNumber } from '../shared/rules.js';
import type { Cel } from '../shared/rules.js';

export interface LayerRow { id: string; name: string; opacity: number; blend: string; visible: boolean; locked_by: string | null; position: number }
export interface FrameRow { id: string; position: number; duration_ms: number }
export interface SpriteRow { id: string; project_id: string; palette_id: string; name: string; width: number; height: number; seq: number }

export async function getSprite(id: number | string): Promise<SpriteRow> {
  const row = await one<SpriteRow>('select id::text, project_id::text, palette_id::text, name, width, height, seq from sprites where id = $1', [id]);
  if (!row) throw notFound();
  return row;
}

export async function getLayers(spriteId: number): Promise<LayerRow[]> {
  return q<LayerRow>(
    'select id::text, name, opacity, blend, visible, locked_by::text, position from layers where sprite_id = $1 order by position asc',
    [spriteId]
  );
}

export async function getFrames(spriteId: number): Promise<FrameRow[]> {
  return q<FrameRow>('select id::text, position, duration_ms from frames where sprite_id = $1 order by position asc', [spriteId]);
}

/** Every cel of a frame; absent cels are fully transparent. */
export async function frameCels(frameId: number, layers: LayerRow[]): Promise<Map<string, number[][]>> {
  const rows = await q<{ layer_id: string; rows: number[][]; link_frame_id: string | null }>(
    'select layer_id::text, rows, link_frame_id::text from cels where frame_id = $1',
    [frameId]
  );
  return new Map(rows.map((r) => [r.layer_id, r.rows]));
}

/** A cel's stored rows, following link chains. */
export async function celRows(frameId: number, layerId: number): Promise<number[][] | null> {
  const row = await one<{ rows: number[][]; link_frame_id: string | null }>(
    'select rows, link_frame_id::text from cels where frame_id = $1 and layer_id = $2',
    [frameId, layerId]
  );
  if (!row) return null;
  if (row.link_frame_id) {
    const linked = await celRows(Number(row.link_frame_id), layerId);
    return linked ?? row.rows;
  }
  return row.rows;
}

/** Write a cel, creating the buffer if needed. Returns true if written. */
export async function writeCel(frameId: number, layerId: number, rows: number[][]): Promise<void> {
  await q(
    `insert into cels (frame_id, layer_id, rows, link_frame_id) values ($1, $2, $3::jsonb, null)
     on conflict (frame_id, layer_id) do update set rows = $3::jsonb, link_frame_id = null`,
    [frameId, layerId, JSON.stringify(rows)]
  );
}

export function blankRows(w: number, h: number): number[][] {
  return Array.from({ length: h }, () => new Array<number>(w).fill(0));
}

/** One sequence number for every sprite operation; the single order. */
export async function nextSeq(spriteId: number, type: string, by: number | null, data: Record<string, unknown>): Promise<number> {
  const row = await one<{ seq: number }>('update sprites set seq = seq + 1 where id = $1 returning seq', [spriteId]);
  const seq = row!.seq;
  await q('insert into sprite_events (sprite_id, seq, type, by, at, data) values ($1, $2, $3, $4, $5, $6::jsonb)',
    [spriteId, seq, type, by, await now(), JSON.stringify(data)]);
  return seq;
}

export async function peekSeq(spriteId: number): Promise<number> {
  const row = await one<{ seq: number }>('select seq from sprites where id = $1', [spriteId]);
  return row ? row.seq : 0;
}

export async function eventsSince(spriteId: number, since: number): Promise<unknown[]> {
  return q(
    'select seq, type, by_name, at, data from (select e.seq, e.type, e.at, e.data, u.name as by_name from sprite_events e left join users u on u.id = e.by where e.sprite_id = $1 and e.seq > $2 order by e.seq asc) t',
    [spriteId, since]
  );
}

// ---- undo stacks ----

export interface UndoAction {
  kind: 'stroke' | 'selection' | 'swatch' | 'tile_place' | 'tile_erase' | 'tile_flip' | 'stamp';
  frame?: number;
  layer?: string;
  before?: number[][];
  after?: number[][];
  swatch?: { index: number; before: string; after: string };
  map?: { mapId: number; before: Record<string, [number, boolean, boolean]>; after: Record<string, [number, boolean, boolean]> };
}

export async function pushUndo(userId: number, spriteId: number, action: UndoAction, depth: number): Promise<void> {
  // drop entries beyond the depth, push the newest at idx 0, and clear redo
  await q(`delete from undo_stack where user_id = $1 and sprite_id = $2 and idx >= $3`, [userId, spriteId, depth - 1]);
  await q('update undo_stack set idx = idx + 1 where user_id = $1 and sprite_id = $2', [userId, spriteId]);
  await q('delete from undo_stack where user_id = $1 and sprite_id = $2 and idx < 0', [userId, spriteId]);
  await q('insert into undo_stack (user_id, sprite_id, idx, action, created_at) values ($1, $2, 0, $3::jsonb, $4)',
    [userId, spriteId, JSON.stringify(action), await now()]);
}

export async function clearRedo(userId: number, spriteId: number): Promise<void> {
  await q('delete from undo_stack where user_id = $1 and sprite_id = $2 and idx < 0', [userId, spriteId]);
}

export async function clearAllUndo(spriteId: number): Promise<void> {
  await q('delete from undo_stack where sprite_id = $1', [spriteId]);
}

export function numText(n: number, format: string): string {
  return formatNumber(n, format === 'en-IN' ? 'en-IN' : 'en-US');
}

export function requireInt(v: unknown, field: string, min = -1e9, max = 1e9): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw fieldErrors({ [field]: `Use ${min} to ${max}` });
  }
  return v;
}

export function toInt(v: unknown, dflt?: number): number | undefined {
  if (v === undefined || v === null) return dflt;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.trunc(n);
}
