import type { PoolClient } from 'pg';
import { asId, spriteAccess } from './access';
import { instant, now } from './clock';
import { one, pool, rows, type Queryable } from './db';
import { invalid, notFound } from './errors';
import { created, route } from './http';
import { loadModel, modelToSnapshot, packSnapshot, snapshotToModel, unpackSnapshot, frameRgba, type SnapshotData, type SpriteRow } from './model';
import { clearUndo, recordActivity, runOperation, type Operation } from './ops';
import { objectBody } from './validate';
import { colourText } from '../shared/colour';
import type { SnapshotInfo } from '../shared/types';

const infoOf = (row: { id: number; name: string; seq: number; at: number }): SnapshotInfo => ({ id: row.id, name: row.name, seq: row.seq, at: instant(row.at) });

export async function loadSnapshotList(q: Queryable, spriteId: number): Promise<SnapshotInfo[]> {
  return (await rows<{ id: number; name: string; seq: number; at: number }>(q, 'SELECT id, name, seq, at FROM snapshots WHERE sprite_id = $1 ORDER BY id DESC', [spriteId])).map(infoOf);
}

/** Stores the whole sprite as it is now under a name. */
export async function captureSnapshot(tx: PoolClient, sprite: SpriteRow, name: string, seq: number, automatic = false): Promise<SnapshotInfo> {
  const model = await loadModel(tx, sprite);
  const at = now();
  const row = await one<{ id: number }>(tx, 'INSERT INTO snapshots (sprite_id, name, seq, at, automatic, data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [
    sprite.id,
    name,
    seq,
    at,
    automatic,
    packSnapshot(modelToSnapshot(model)),
  ]);
  return infoOf({ id: row?.id ?? 0, name, seq, at });
}

route('GET', '/api/sprites/:id/snapshots', async (ctx) => {
  const { sprite } = await spriteAccess(ctx.need().id, asId(ctx.params.id));
  return { snapshots: await loadSnapshotList(pool, sprite.id) };
});

route('POST', '/api/sprites/:id/snapshots', (ctx) =>
  runOperation(ctx.need().id, asId(ctx.params.id), 'owner', async (op) => {
    const name = typeof objectBody(ctx.body).name === 'string' ? (objectBody(ctx.body).name as string).trim() : '';
    if (name === '' || name.length > 80) throw invalid({ name: 'Name the snapshot in up to 80 characters' });
    if (await one(op.tx, 'SELECT 1 FROM snapshots WHERE sprite_id = $1 AND name = $2 AND NOT automatic', [op.sprite.id, name])) throw invalid({ name: 'That name is taken' });
    const seq = op.sprite.seq + 1;
    const info = await captureSnapshot(op.tx, op.sprite, name, seq);
    await op.emit('snapshot', { snapshot: info });
    return created(info);
  }),
);

async function snapshotData(spriteId: number, id: unknown): Promise<SnapshotData> {
  const row = await one<{ data: Buffer }>(pool, 'SELECT data FROM snapshots WHERE sprite_id = $1 AND id = $2', [spriteId, Number(id)]);
  if (!row) throw notFound();
  return unpackSnapshot(row.data);
}

route('GET', '/api/sprites/:id/snapshots/compare', async (ctx) => {
  const { sprite } = await spriteAccess(ctx.need().id, asId(ctx.params.id));
  const [from, to] = await Promise.all([snapshotData(sprite.id, ctx.query.get('from')), snapshotData(sprite.id, ctx.query.get('to'))]);
  const sides = [from, to].map((data) => snapshotToModel(data, sprite));
  const count = Math.max(...sides.map((m) => m.frames.length));
  const frames: { frame: number; changed: number; cells: { x: number; y: number; before: string; after: string }[] }[] = [];
  const blank = new Uint8Array(sprite.width * sprite.height * 4);
  for (let n = 0; n < count; n++) {
    const [before, after] = sides.map((m) => (m.frames[n] ? frameRgba(m, m.frames[n]?.id ?? 0) : blank));
    const cells: { x: number; y: number; before: string; after: string }[] = [];
    for (let at = 0; at < sprite.width * sprite.height; at++) {
      const a = before?.subarray(at * 4, at * 4 + 4) ?? blank;
      const b = after?.subarray(at * 4, at * 4 + 4) ?? blank;
      if (a.some((v, i) => v !== b[i])) {
        cells.push({ x: at % sprite.width, y: Math.floor(at / sprite.width), before: colourText(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 0), after: colourText(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0) });
      }
    }
    if (cells.length > 0) frames.push({ frame: n + 1, changed: cells.length, cells });
  }
  return { frames };
});

/** Replaces the sprite's artwork with a snapshot, byte for byte, keeping every id it had. */
async function replaceWithSnapshot(op: Operation, data: SnapshotData): Promise<void> {
  const { tx, sprite } = op;
  await tx.query('DELETE FROM layers WHERE sprite_id = $1', [sprite.id]);
  await tx.query('DELETE FROM frames WHERE sprite_id = $1', [sprite.id]);
  await tx.query('DELETE FROM buffers WHERE sprite_id = $1', [sprite.id]);
  await tx.query('DELETE FROM tags WHERE sprite_id = $1', [sprite.id]);
  await tx.query('DELETE FROM tilesets WHERE sprite_id = $1', [sprite.id]);
  for (const f of data.frames) await tx.query('INSERT INTO frames (id, sprite_id, position, duration_ms) VALUES ($1, $2, $3, $4)', [f.id, sprite.id, f.position, f.duration_ms]);
  for (const l of data.layers) {
    await tx.query('INSERT INTO layers (id, sprite_id, name, opacity, blend, visible, locked_by, position) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)', [l.id, sprite.id, l.name, l.opacity, l.blend, l.visible, l.position]);
  }
  for (const b of data.buffers) await tx.query('INSERT INTO buffers (id, sprite_id, data) VALUES ($1, $2, $3)', [b.id, sprite.id, Buffer.from(b.data, 'base64')]);
  for (const c of data.cels) await tx.query('INSERT INTO cels (frame_id, layer_id, buffer_id) VALUES ($1, $2, $3)', [c.frame, c.layer, c.buffer]);
  for (const t of data.tags) {
    await tx.query('INSERT INTO tags (id, sprite_id, name, from_frame, to_frame, direction, repeat) VALUES ($1, $2, $3, $4, $5, $6, $7)', [t.id, sprite.id, t.name, t.from_frame, t.to_frame, t.direction, t.repeat]);
  }
  for (const set of data.tilesets) {
    await tx.query('INSERT INTO tilesets (id, sprite_id, name, tile_size, edge_table) VALUES ($1, $2, $3, $4, $5)', [set.id, sprite.id, set.name, set.tile_size, set.edge_table]);
    for (const [i, tile] of set.tiles.entries()) await tx.query('INSERT INTO tiles (tileset_id, number, data) VALUES ($1, $2, $3)', [set.id, i + 1, Buffer.from(tile, 'base64')]);
  }
  for (const map of data.tilemaps) {
    await tx.query('INSERT INTO tilemaps (id, sprite_id, tileset_id, name, width, height) VALUES ($1, $2, $3, $4, $5, $6)', [map.id, sprite.id, map.tileset_id, map.name, map.width, map.height]);
    for (const [x, y, tile, flipH, flipV] of map.cells) {
      await tx.query('INSERT INTO map_cells (tilemap_id, x, y, tile, flip_h, flip_v) VALUES ($1, $2, $3, $4, $5, $6)', [map.id, x, y, tile, flipH, flipV]);
    }
  }
  const wanted = new Map(data.swatches.map((s) => [s.idx, s]));
  const existing = await rows<{ idx: number; color: string; version: number; removed: boolean }>(tx, 'SELECT idx, color, version, removed FROM swatches WHERE palette_id = $1', [sprite.palette_id]);
  for (const row of existing) {
    const target = wanted.get(row.idx);
    if (!target && !row.removed) await tx.query('UPDATE swatches SET removed = true, removed_by = $3 WHERE palette_id = $1 AND idx = $2', [sprite.palette_id, row.idx, op.userId]);
    else if (target && (row.removed || row.color !== target.color)) {
      await tx.query('UPDATE swatches SET color = $3, version = version + 1, removed = false, removed_by = NULL, edited_by = $4 WHERE palette_id = $1 AND idx = $2', [sprite.palette_id, row.idx, target.color, target.edited_by]);
    }
  }
  for (const target of data.swatches.filter((s) => !existing.some((row) => row.idx === s.idx))) {
    await tx.query('INSERT INTO swatches (palette_id, idx, color, version, edited_by) VALUES ($1, $2, $3, $4, $5)', [sprite.palette_id, target.idx, target.color, target.version, target.edited_by]);
  }
  await tx.query('UPDATE palettes SET ord = $2::int[] WHERE id = $1', [sprite.palette_id, data.order]);
}

route('POST', '/api/snapshots/:id/restore', async (ctx) => {
  const user = ctx.need();
  const row = await one<{ sprite_id: number; name: string; data: Buffer }>(pool, 'SELECT sprite_id, name, data FROM snapshots WHERE id = $1', [asId(ctx.params.id)]);
  if (!row) throw notFound();
  return runOperation(user.id, row.sprite_id, 'owner', async (op) => {
    const before = await captureSnapshot(op.tx, op.sprite, `Before restore ${row.name}`, op.sprite.seq + 1, true);
    await op.emit('snapshot', { snapshot: before });
    await replaceWithSnapshot(op, unpackSnapshot(row.data));
    await clearUndo(op.tx, op.sprite.id);
    const seq = await op.emit('restore', { refresh: true, notice: { kind: 'restored', name: row.name } });
    await recordActivity(op.tx, op.sprite.project_id, op.userId, op.sprite.id, { kind: 'restore', data: { snapshot: row.name } });
    return { seq, before_snapshot: before.id };
  });
});
