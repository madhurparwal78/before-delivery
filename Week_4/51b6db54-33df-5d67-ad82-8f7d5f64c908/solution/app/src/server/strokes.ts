import type { PoolClient } from 'pg';
import { asId } from './access';
import { conflict } from './errors';
import { route, created } from './http';
import { loadSwatches, loadLayers, loadFrames, type LayerRow, type SpriteRow } from './model';
import { one, rows } from './db';
import { recordActivity, runOperation, type Change, type Operation } from './ops';
import { Errors, intIn, isInt, objectBody } from './validate';
import { cursorOf } from './hub';
import { diffWrites, selectionWrites, strokeWrites, type Point, type StrokeOptions, type Writes } from '../shared/engine';
import { MIRRORS, SELECTION_OPS, STROKE_TOOLS, BRUSH_MAX, type Mirror, type SelectionOp, type StrokeTool } from '../shared/rules';
import { formatNumber, type Locale } from '../shared/format';
import type { MapCell } from '../shared/tiles';
import type { Patch, SwatchInfo } from '../shared/types';
import { userNames } from './auth';

const bufferOf = async (tx: PoolClient, frameId: number, layerId: number): Promise<{ id: number; data: Uint8Array } | null> => {
  const found = await one<{ id: number; data: Buffer }>(
    tx,
    'SELECT b.id, b.data FROM cels c JOIN buffers b ON b.id = c.buffer_id WHERE c.frame_id = $1 AND c.layer_id = $2',
    [frameId, layerId],
  );
  return found ? { id: found.id, data: new Uint8Array(found.data) } : null;
};

/** Creates an empty cel for a frame and layer, returning its buffer id. */
export async function createCel(tx: PoolClient, sprite: SpriteRow, frameId: number, layerId: number, data?: Uint8Array): Promise<number> {
  const buffer = await one<{ id: number }>(tx, 'INSERT INTO buffers (sprite_id, data) VALUES ($1, $2) RETURNING id', [
    sprite.id,
    Buffer.from(data ?? new Uint8Array(sprite.width * sprite.height)),
  ]);
  const id = buffer?.id ?? 0;
  await tx.query('INSERT INTO cels (frame_id, layer_id, buffer_id) VALUES ($1, $2, $3) ON CONFLICT (frame_id, layer_id) DO UPDATE SET buffer_id = $3', [frameId, layerId, id]);
  return id;
}

export const lockedByOther = async (layer: LayerRow, userId: number): Promise<string | null> => {
  if (layer.locked_by === null || layer.locked_by === userId) return null;
  return (await userNames([layer.locked_by])).get(layer.locked_by) ?? '';
};

/** The live swatch indices and removed indices of a palette. */
const swatchState = async (tx: PoolClient, paletteId: number): Promise<{ live: Set<number>; removed: Set<number> }> => {
  const all = await loadSwatches(tx, paletteId);
  return { live: new Set(all.filter((s) => !s.removed).map((s) => s.idx)), removed: new Set(all.filter((s) => s.removed).map((s) => s.idx)) };
};

interface Target {
  frameId: number;
  layer: LayerRow;
}

/** Writes a stroke or selection result to the cel and emits it; the one place cel pixels change. */
async function applyWrites(op: Operation, target: Target, writes: Writes, type: 'stroke' | 'selection', csid: string): Promise<{ seq: number; pixels_changed: number }> {
  const existing = await bufferOf(op.tx, target.frameId, target.layer.id);
  const cel = existing?.data ?? new Uint8Array(op.sprite.width * op.sprite.height);
  const diff = diffWrites(cel, writes);
  const patch: Patch = { csid };
  let bufferId = existing?.id ?? 0;
  if (diff.length > 0) {
    if (!existing) {
      bufferId = await createCel(op.tx, op.sprite, target.frameId, target.layer.id);
      patch.buffers = [{ id: bufferId }];
      patch.cels = [{ frame: target.frameId, layer: target.layer.id, buffer: bufferId }];
    }
    for (const [at, , after] of diff) cel[at] = after;
    await op.tx.query('UPDATE buffers SET data = $2 WHERE id = $1', [bufferId, Buffer.from(cel)]);
    patch.cells = diff.map(([at, , after]) => [bufferId, at, after]);
    patch.counts = await op.counts();
  }
  const changes: Change[] = diff.map(([at, before, after]) => ['cel', bufferId, at, before, after]);
  const seq = await op.emit(type, patch, changes);
  if (changes.length > 0) {
    await op.recordUndo(seq, changes);
    await recordActivity(op.tx, op.sprite.project_id, op.userId, op.sprite.id, {
      kind: 'paint',
      data: { pixels: diff.length, frame: await frameNumber(op.tx, target.frameId) },
    });
  }
  const answer = { seq, pixels_changed: diff.length };
  await op.tx.query('INSERT INTO stroke_log (sprite_id, user_id, csid, response) VALUES ($1, $2, $3, $4)', [op.sprite.id, op.userId, csid, JSON.stringify(answer)]);
  return answer;
}

const frameNumber = async (tx: PoolClient, frameId: number): Promise<number> =>
  (await one<{ position: number }>(tx, 'SELECT position FROM frames WHERE id = $1', [frameId]))?.position ?? 0;

interface Resolved {
  target: Target;
  errors: Errors;
}

/** Resolves the frame and layer of a request, refusing a lock held by someone else before field errors. */
async function resolveTarget(op: Operation, body: Record<string, unknown>, locale: Locale): Promise<Resolved> {
  const errors = new Errors();
  const frames = await loadFrames(op.tx, op.sprite.id);
  const layers = await loadLayers(op.tx, op.sprite.id);
  const frame = isInt(body.frame) ? frames[body.frame - 1] : undefined;
  const layer = layers.find((l) => l.name === body.layer);
  if (!frame) errors.add('frame', `Use 1 to ${formatNumber(frames.length, locale.number_format)}`);
  if (!layer) errors.add('layer', 'Choose a layer of this sprite');
  if (layer) {
    const holder = await lockedByOther(layer, op.userId);
    if (holder !== null) throw conflict('layer_locked', { message: `Locked by ${holder}` });
  }
  return { target: { frameId: frame?.id ?? 0, layer: layer as LayerRow }, errors };
}

const isPoint = (p: unknown): p is Point => Array.isArray(p) && p.length === 2 && isInt(p[0]) && isInt(p[1]);

const POINT_COUNTS: Record<StrokeTool, [number, number]> = {
  pencil: [1, Infinity],
  eraser: [1, Infinity],
  line: [2, 2],
  rectangle: [2, 2],
  ellipse: [2, 2],
  fill: [1, 1],
  dither: [1, 1],
};

route('POST', '/api/sprites/:id/strokes', async (ctx) => {
  const user = ctx.need();
  return runOperation(user.id, asId(ctx.params.id), 'draw', async (op) => {
    const body = objectBody(ctx.body);
    const csid = typeof body.client_stroke_id === 'string' ? body.client_stroke_id : '';
    const stored = await one<{ response: unknown }>(op.tx, 'SELECT response FROM stroke_log WHERE sprite_id = $1 AND user_id = $2 AND csid = $3', [op.sprite.id, user.id, csid]);
    if (stored) return created(stored.response);
    const { target, errors } = await resolveTarget(op, body, ctx.locale);
    const tool = body.tool as StrokeTool;
    const options = objectBody(body.options) as StrokeOptions;
    const points = Array.isArray(body.points) ? body.points : [];
    const swatches = await swatchState(op.tx, op.sprite.palette_id);
    if (csid === '' || csid.length > 100) errors.add('client_stroke_id', 'Send a stroke id');
    if (!STROKE_TOOLS.includes(tool)) errors.add('tool', `Use ${STROKE_TOOLS.join(', ')}`);
    else {
      const [least, most] = POINT_COUNTS[tool];
      const inSprite = points.every((p) => isPoint(p) && p[0] >= 0 && p[1] >= 0 && p[0] < op.sprite.width && p[1] < op.sprite.height);
      if (points.length < least || points.length > most || !inSprite) errors.add('points', 'Send cells inside the sprite');
    }
    if (!intIn(body.size, 1, BRUSH_MAX)) errors.add('size', `Use 1 to ${BRUSH_MAX}`);
    if (!MIRRORS.includes(body.mirror as Mirror)) errors.add('mirror', `Use ${MIRRORS.join(', ')}`);
    const known = (index: unknown): boolean => index === 0 || (isInt(index) && swatches.live.has(index));
    if (!known(body.swatch)) errors.add('swatch', `Swatch ${String(body.swatch)} was removed`);
    if (options.secondary !== undefined && !known(options.secondary)) errors.add('swatch', `Swatch ${String(options.secondary)} was removed`);
    if (options.level !== undefined && !intIn(options.level, 1, 16)) errors.add('options', 'Use a dither level from 1 to 16');
    errors.check();
    const cel = (await bufferOf(op.tx, target.frameId, target.layer.id))?.data ?? new Uint8Array(op.sprite.width * op.sprite.height);
    const writes = strokeWrites(cel, op.sprite, { tool, points: points as Point[], swatch: body.swatch as number, size: body.size as number, mirror: body.mirror as Mirror, options });
    return created(await applyWrites(op, target, writes, 'stroke', csid));
  });
});

route('POST', '/api/sprites/:id/selection', async (ctx) => {
  const user = ctx.need();
  return runOperation(user.id, asId(ctx.params.id), 'draw', async (op) => {
    const body = objectBody(ctx.body);
    const csid = typeof body.client_stroke_id === 'string' ? body.client_stroke_id : '';
    const stored = await one<{ response: unknown }>(op.tx, 'SELECT response FROM stroke_log WHERE sprite_id = $1 AND user_id = $2 AND csid = $3', [op.sprite.id, user.id, csid]);
    if (stored) return created(stored.response);
    const { target, errors } = await resolveTarget(op, body, ctx.locale);
    const operation = body.op as SelectionOp;
    const rect = objectBody(body.rect);
    const to = objectBody(body.to);
    const swatches = await swatchState(op.tx, op.sprite.palette_id);
    if (csid === '' || csid.length > 100) errors.add('client_stroke_id', 'Send a stroke id');
    if (!SELECTION_OPS.includes(operation)) errors.add('op', `Use ${SELECTION_OPS.join(', ')}`);
    const rectOk =
      isInt(rect.x) && isInt(rect.y) && isInt(rect.w) && isInt(rect.h) && rect.x >= 0 && rect.y >= 0 && rect.w >= 1 && rect.h >= 1 &&
      rect.x + rect.w <= op.sprite.width && rect.y + rect.h <= op.sprite.height;
    if (operation !== 'paste' && !rectOk) errors.add('rect', 'Select cells inside the sprite');
    if ((operation === 'move' || operation === 'paste') && !(isInt(to.x) && isInt(to.y))) errors.add('to', 'Choose where to place the cells');
    const pasted = Array.isArray(body.rows) ? body.rows : [];
    if (operation === 'paste' && !(pasted.length > 0 && pasted.every((r) => Array.isArray(r) && r.every((v) => v === 0 || (isInt(v) && swatches.live.has(v)))))) {
      errors.add('rows', 'Send rows of swatch indices');
    }
    errors.check();
    const cel = (await bufferOf(op.tx, target.frameId, target.layer.id))?.data ?? new Uint8Array(op.sprite.width * op.sprite.height);
    const writes = selectionWrites(cel, op.sprite, {
      op: operation,
      rect: rect as { x: number; y: number; w: number; h: number },
      to: to as { x: number; y: number },
      rows: pasted as number[][],
    });
    return created(await applyWrites(op, target, writes, 'selection', csid));
  });
});

const targetKey = (change: Change): string => {
  if (change[0] === 'cel') return `c:${change[1]}:${change[2]}`;
  if (change[0] === 'swatch') return `s:${change[1]}:${change[2]}`;
  return `m:${change[1]}:${change[2]}:${change[3]}`;
};

/** The value a change leaves in place when applied forward (after) or back (before). */
const current = async (tx: PoolClient, change: Change): Promise<string> => {
  if (change[0] === 'cel') {
    const found = await one<{ v: number }>(tx, 'SELECT get_byte(data, $2) AS v FROM buffers WHERE id = $1', [change[1], change[2]]);
    return String(found?.v ?? -1);
  }
  if (change[0] === 'swatch') {
    const found = await one<{ color: string; removed: boolean }>(tx, 'SELECT color, removed FROM swatches WHERE palette_id = $1 AND idx = $2', [change[1], change[2]]);
    return found && !found.removed ? found.color : 'removed';
  }
  const cell = await one<{ tile: number; flip_h: boolean; flip_v: boolean }>(tx, 'SELECT tile, flip_h, flip_v FROM map_cells WHERE tilemap_id = $1 AND x = $2 AND y = $3', [change[1], change[2], change[3]]);
  return `${cell?.tile ?? 0}:${cell?.flip_h ?? false}:${cell?.flip_v ?? false}`;
};

const expected = (change: Change, side: 'before' | 'after'): string => {
  if (change[0] === 'cel') return String(side === 'before' ? change[3] : change[4]);
  if (change[0] === 'swatch') return side === 'before' ? change[3] : change[4];
  return side === 'before' ? `${change[4]}:${change[5]}:${change[6]}` : `${change[7]}:${change[8]}:${change[9]}`;
};

/** Who most recently changed one of these targets after an event. */
async function culprit(tx: PoolClient, spriteId: number, afterSeq: number, userId: number, changes: Change[]): Promise<string> {
  const keys = new Set(changes.map(targetKey));
  const later = await rows<{ name: string; changes: Change[] }>(
    tx,
    `SELECT u.name, e.changes FROM events e JOIN users u ON u.id = e.by_user
     WHERE e.sprite_id = $1 AND e.seq > $2 AND e.by_user <> $3 AND e.changes IS NOT NULL ORDER BY e.seq DESC LIMIT 500`,
    [spriteId, afterSeq, userId],
  );
  return later.find((event) => event.changes.some((change) => keys.has(targetKey(change))))?.name ?? later[0]?.name ?? '';
}

const inverse = (change: Change): Change => {
  if (change[0] === 'cel') return ['cel', change[1], change[2], change[4], change[3]];
  if (change[0] === 'swatch') return ['swatch', change[1], change[2], change[4], change[3]];
  return ['map', change[1], change[2], change[3], change[7], change[8], change[9], change[4], change[5], change[6]];
};

/** Writes a change set to the artwork and returns the patch that tells everyone. */
export async function applyChanges(op: Operation, changes: Change[]): Promise<Patch> {
  const patch: Patch = {};
  const cels = new Map<number, Buffer>();
  const swatches: SwatchInfo[] = [];
  const mapCells = new Map<number, { map: number; cells: MapCell[] }>();
  for (const change of changes) {
    if (change[0] === 'cel') {
      let data = cels.get(change[1]);
      if (!data) {
        data = (await one<{ data: Buffer }>(op.tx, 'SELECT data FROM buffers WHERE id = $1', [change[1]]))?.data ?? Buffer.alloc(0);
        cels.set(change[1], data);
      }
      data[change[2]] = change[4];
      (patch.cells ??= []).push([change[1], change[2], change[4]]);
    } else if (change[0] === 'swatch') {
      const updated = await one<{ version: number }>(
        op.tx,
        'UPDATE swatches SET color = $3, version = version + 1, edited_by = $4 WHERE palette_id = $1 AND idx = $2 RETURNING version',
        [change[1], change[2], change[4], op.userId],
      );
      swatches.push({ index: change[2], color: change[4], version: updated?.version ?? 0, edited_by: op.userName });
    } else {
      const [, mapId, x, y, , , , tile, flipH, flipV] = change;
      if (tile === 0) await op.tx.query('DELETE FROM map_cells WHERE tilemap_id = $1 AND x = $2 AND y = $3', [mapId, x, y]);
      else {
        await op.tx.query(
          `INSERT INTO map_cells (tilemap_id, x, y, tile, flip_h, flip_v) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (tilemap_id, x, y) DO UPDATE SET tile = $4, flip_h = $5, flip_v = $6`,
          [mapId, x, y, tile, flipH, flipV],
        );
      }
      const entry = mapCells.get(mapId) ?? { map: mapId, cells: [] };
      entry.cells.push({ x, y, tile, flip_h: flipH, flip_v: flipV });
      mapCells.set(mapId, entry);
    }
  }
  for (const [id, data] of cels) await op.tx.query('UPDATE buffers SET data = $2 WHERE id = $1', [id, data]);
  if (swatches.length > 0) patch.swatches = swatches;
  if (mapCells.size > 0) patch.mapCells = [...mapCells.values()];
  patch.counts = await op.counts();
  return patch;
}

async function step(op: Operation, direction: 'undo' | 'redo') {
  const top = await one<{ id: number; seq: number; changes: Change[] }>(
    op.tx,
    'SELECT id, seq, changes FROM undo_entries WHERE sprite_id = $1 AND user_id = $2 AND side = $3 ORDER BY id DESC LIMIT 1',
    [op.sprite.id, op.userId, direction],
  );
  if (!top) {
    throw conflict(direction === 'undo' ? 'nothing_to_undo' : 'nothing_to_redo', { message: direction === 'undo' ? 'Nothing to undo' : 'Nothing to redo' });
  }
  for (const change of top.changes) {
    if ((await current(op.tx, change)) !== expected(change, direction === 'undo' ? 'after' : 'before')) {
      const name = await culprit(op.tx, op.sprite.id, top.seq, op.userId, top.changes);
      throw conflict('undo_conflict', { message: `Can't ${direction}: ${name} changed this` });
    }
  }
  const applied = direction === 'undo' ? top.changes.map(inverse) : top.changes;
  const patch = await applyChanges(op, applied);
  const swatch = patch.swatches?.[0];
  if (swatch) {
    const cursor = cursorOf(op.sprite.id, op.userId);
    patch.flood = {
      index: swatch.index,
      color: swatch.color,
      cursor: [cursor.x, cursor.y],
      used_by: patch.counts?.pixels[swatch.index] ?? 0,
      frames: patch.counts?.frames[swatch.index] ?? 0,
    };
  }
  const seq = await op.emit(direction, patch, applied);
  await op.tx.query('DELETE FROM undo_entries WHERE id = $1', [top.id]);
  await op.tx.query('INSERT INTO undo_entries (sprite_id, user_id, side, seq, changes) VALUES ($1, $2, $3, $4, $5)', [
    op.sprite.id,
    op.userId,
    direction === 'undo' ? 'redo' : 'undo',
    seq,
    JSON.stringify(top.changes),
  ]);
  return { seq, pixels_changed: top.changes.filter((change) => change[0] === 'cel').length };
}

route('POST', '/api/sprites/:id/undo', (ctx) => runOperation(ctx.need().id, asId(ctx.params.id), 'draw', (op) => step(op, 'undo')));
route('POST', '/api/sprites/:id/redo', (ctx) => runOperation(ctx.need().id, asId(ctx.params.id), 'draw', (op) => step(op, 'redo')));
