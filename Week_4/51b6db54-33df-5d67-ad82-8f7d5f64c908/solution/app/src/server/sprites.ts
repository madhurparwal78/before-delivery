import { asId, require, roleIn, spriteAccess } from './access';
import { config } from './config';
import { loadComments } from './comments';
import { loadSnapshotList } from './snapshots';
import { one, pool, rows } from './db';
import { conflict, forbidden, invalid, notFound } from './errors';
import { created, route, type Ctx } from './http';
import { frameInfos, layerInfos, swatchInfosOf, tagInfos, tilemapInfo, tilesetInfo } from './infos';
import { loadCounts, loadModel, loadSpriteRow, frameRgba, loadSwatches, type LayerRow } from './model';
import { clearUndo, runOperation, type Operation } from './ops';
import { addSwatches } from './palette';
import { createCel, lockedByOther } from './strokes';
import { Errors, intIn, isInt, objectBody } from './validate';
import { colourRows, colourTable, compositeFrame } from '../shared/composite';
import { colourText } from '../shared/colour';
import { formatNumber, type Locale } from '../shared/format';
import { BLENDS, DIRECTIONS, TAG_REPEAT_MAX, type Blend, type Direction } from '../shared/rules';
import { now } from './clock';
import type { Workspace } from '../shared/types';

const nameOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

route('POST', '/api/projects/:id/sprites', async (ctx) => {
  const user = ctx.need();
  const projectId = asId(ctx.params.id);
  const role = await roleIn(pool, user.id, projectId);
  require(role, 'artwork');
  const body = objectBody(ctx.body);
  const errors = new Errors();
  const { spriteMax } = config.limits;
  const limit = formatNumber(spriteMax, ctx.locale.number_format);
  if (nameOf(body.name) === '' || nameOf(body.name).length > 80) errors.add('name', 'Name the sprite in up to 80 characters');
  for (const field of ['width', 'height'] as const) {
    const value = body[field];
    if (isInt(value) && value > spriteMax) errors.add(field, `Largest size is ${limit}`);
    else if (!isInt(value) || value < 1) errors.add(field, 'Use a whole number from 1');
  }
  errors.check();
  const palette = await one<{ id: number }>(pool, 'INSERT INTO palettes DEFAULT VALUES RETURNING id');
  const sprite = await one<{ id: number }>(
    pool,
    'INSERT INTO sprites (project_id, palette_id, name, width, height, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [projectId, palette?.id, nameOf(body.name), body.width, body.height, now()],
  );
  const frameMs = Math.min(config.limits.frameMaxMs, Math.max(config.limits.frameMinMs, 100));
  await pool.query('INSERT INTO frames (sprite_id, position, duration_ms) VALUES ($1, 1, $2)', [sprite?.id, frameMs]);
  await pool.query("INSERT INTO layers (sprite_id, name, opacity, blend, visible, position) VALUES ($1, 'Layer 1', 100, 'normal', true, 1)", [sprite?.id]);
  return created({ id: sprite?.id, palette: palette?.id, seq: 0 });
});

route('GET', '/api/sprites/:id', async (ctx) => {
  const { sprite } = await spriteAccess(ctx.need().id, asId(ctx.params.id));
  const layers = await layerInfos(pool, sprite.id);
  const frames = await frameInfos(pool, sprite.id);
  const tags = await tagInfos(pool, sprite.id);
  const tilesets = await rows<{ id: number }>(pool, 'SELECT id FROM tilesets WHERE sprite_id = $1 ORDER BY id', [sprite.id]);
  const tilemaps = await rows<{ id: number }>(pool, 'SELECT id FROM tilemaps WHERE sprite_id = $1 ORDER BY id', [sprite.id]);
  const celRows = await rows<{ frame_id: number; layer_id: number; buffer_id: number }>(
    pool,
    'SELECT c.frame_id, c.layer_id, c.buffer_id FROM cels c JOIN frames f ON f.id = c.frame_id WHERE f.sprite_id = $1',
    [sprite.id],
  );
  const sharing = new Map<string, number>();
  for (const cel of celRows) sharing.set(`${cel.layer_id}:${cel.buffer_id}`, (sharing.get(`${cel.layer_id}:${cel.buffer_id}`) ?? 0) + 1);
  return {
    id: sprite.id,
    name: sprite.name,
    width: sprite.width,
    height: sprite.height,
    seq: sprite.seq,
    palette: sprite.palette_id,
    layers,
    frames: frames.map((frame, i) => ({
      number: i + 1,
      duration_ms: frame.duration_ms,
      linked_layers: celRows.filter((c) => c.frame_id === frame.id && (sharing.get(`${c.layer_id}:${c.buffer_id}`) ?? 0) > 1).map((c) => c.layer_id),
    })),
    tags,
    tilesets: tilesets.map((t) => t.id),
    tilemaps: tilemaps.map((t) => t.id),
  };
});

route('GET', '/api/sprites/:id/workspace', async (ctx) => {
  const user = ctx.need();
  const { sprite, role } = await spriteAccess(user.id, asId(ctx.params.id));
  const model = await loadModel(pool, sprite);
  const project = await one<{ id: number; name: string }>(pool, 'SELECT id, name FROM projects WHERE id = $1', [sprite.project_id]);
  const workspace: Workspace = {
    sprite: { id: sprite.id, name: sprite.name, width: sprite.width, height: sprite.height, seq: sprite.seq, palette: sprite.palette_id, project: project ?? { id: 0, name: '' } },
    role,
    me: { id: user.id, name: user.name },
    layers: await layerInfos(pool, sprite.id),
    frames: model.frames.map(({ id, duration_ms }) => ({ id, duration_ms })),
    cels: [...model.cels].map(([key, buffer]) => {
      const [frame = 0, layer = 0] = key.split(':').map(Number);
      return { frame, layer, buffer };
    }),
    buffers: [...model.buffers].map(([id, data]) => ({ id, data: Buffer.from(data).toString('base64') })),
    swatches: await swatchInfosOf(pool, sprite.palette_id),
    order: model.order,
    counts: await loadCounts(pool, sprite.id),
    tags: await tagInfos(pool, sprite.id),
    tilesets: model.tilesets.map(tilesetInfo),
    tilemaps: model.tilemaps.map(tilemapInfo),
    comments: await loadComments(pool, sprite.id),
    snapshots: await loadSnapshotList(pool, sprite.id),
    now: now(),
  };
  return workspace;
});

async function frameAt(spriteId: number, number: string | undefined): Promise<{ id: number; position: number }> {
  const position = asId(number);
  const frame = await one<{ id: number; position: number }>(pool, 'SELECT id, position FROM frames WHERE sprite_id = $1 AND position = $2', [spriteId, position]);
  if (!frame) throw notFound();
  return frame;
}

route('GET', '/api/sprites/:id/frames/:n/pixels', async (ctx) => {
  const { sprite } = await spriteAccess(ctx.need().id, asId(ctx.params.id));
  const frame = await frameAt(sprite.id, ctx.params.n);
  const model = await loadModel(pool, sprite);
  const layerName = ctx.query.get('layer');
  const only = layerName === null ? undefined : model.layers.find((l) => l.name === layerName);
  if (layerName !== null && !only) throw invalid({ layer: 'Choose a layer of this sprite' });
  const rgba = frameRgba(model, frame.id, only);
  return { width: sprite.width, height: sprite.height, seq: sprite.seq, rows: colourRows(rgba, sprite.width, sprite.height) };
});

route('GET', '/api/sprites/:id/frames/:n/indices', async (ctx) => {
  const { sprite } = await spriteAccess(ctx.need().id, asId(ctx.params.id));
  const frame = await frameAt(sprite.id, ctx.params.n);
  const layerName = ctx.query.get('layer');
  const layer = (await loadModel(pool, sprite).then((m) => m.layers)).find((l) => l.name === layerName);
  if (!layer) throw invalid({ layer: 'Choose a layer of this sprite' });
  const cel = await one<{ buffer_id: number; data: Buffer }>(
    pool,
    'SELECT c.buffer_id, b.data FROM cels c JOIN buffers b ON b.id = c.buffer_id WHERE c.frame_id = $1 AND c.layer_id = $2',
    [frame.id, layer.id],
  );
  const data = cel?.data ?? Buffer.alloc(sprite.width * sprite.height);
  const linked = cel
    ? await rows<{ position: number }>(pool, 'SELECT f.position FROM cels c JOIN frames f ON f.id = c.frame_id WHERE c.layer_id = $1 AND c.buffer_id = $2 ORDER BY f.position', [layer.id, cel.buffer_id])
    : [frame];
  return {
    width: sprite.width,
    height: sprite.height,
    seq: sprite.seq,
    rows: Array.from({ length: sprite.height }, (_, y) => Array.from(data.subarray(y * sprite.width, (y + 1) * sprite.width))),
    linked_frames: linked.map((f) => f.position),
  };
});

const layersPatch = async (op: Operation) => ({ layers: await layerInfos(op.tx, op.sprite.id) });

async function layerOf(op: Operation, id: string | undefined): Promise<LayerRow> {
  const layer = (await rows<LayerRow>(op.tx, 'SELECT id, name, opacity, blend, visible, locked_by, position FROM layers WHERE sprite_id = $1 AND id = $2', [op.sprite.id, asId(id)]))[0];
  if (!layer) throw notFound();
  return layer;
}

route('POST', '/api/sprites/:id/layers', (ctx) =>
  runOperation(ctx.need().id, asId(ctx.params.id), 'artwork', async (op) => {
    const body = objectBody(ctx.body);
    const existing = await rows<{ name: string }>(op.tx, 'SELECT name FROM layers WHERE sprite_id = $1', [op.sprite.id]);
    let name = nameOf(body.name);
    if (body.name !== undefined && (name === '' || name.length > 80)) throw invalid({ name: 'Name the layer in up to 80 characters' });
    if (name === '') {
      let n = existing.length + 1;
      while (existing.some((l) => l.name === `Layer ${n}`)) n += 1;
      name = `Layer ${n}`;
    } else if (existing.some((l) => l.name === name)) throw invalid({ name: 'That name is taken' });
    await op.tx.query('UPDATE layers SET position = position + 1 WHERE sprite_id = $1', [op.sprite.id]);
    const layer = await one<{ id: number }>(
      op.tx,
      "INSERT INTO layers (sprite_id, name, opacity, blend, visible, position) VALUES ($1, $2, 100, 'normal', true, 1) RETURNING id",
      [op.sprite.id, name],
    );
    const seq = await op.emit('layer', await layersPatch(op));
    return created({ id: layer?.id, name, seq });
  }),
);

route('PATCH', '/api/sprites/:id/layers/:layer', (ctx) =>
  runOperation(ctx.need().id, asId(ctx.params.id), 'artwork', async (op) => {
    const layer = await layerOf(op, ctx.params.layer);
    const body = objectBody(ctx.body);
    const total = (await one<{ n: number }>(op.tx, 'SELECT count(*)::int AS n FROM layers WHERE sprite_id = $1', [op.sprite.id]))?.n ?? 0;
    const errors = new Errors();
    if (body.opacity !== undefined && !intIn(body.opacity, 0, 100)) errors.add('opacity', 'Use 0 to 100');
    if (body.blend !== undefined && !BLENDS.includes(body.blend as Blend)) errors.add('blend', `Use ${BLENDS.join(' or ')}`);
    if (body.visible !== undefined && typeof body.visible !== 'boolean') errors.add('visible', 'Use true or false');
    if (body.position !== undefined && !intIn(body.position, 1, total)) errors.add('position', `Use 1 to ${formatNumber(total, ctx.locale.number_format)}`);
    errors.check();
    if (typeof body.position === 'number' && body.position !== layer.position) {
      const from = layer.position;
      const to = body.position;
      await op.tx.query('UPDATE layers SET position = position + $3 WHERE sprite_id = $1 AND position BETWEEN $2 AND $4 AND id <> $5', [
        op.sprite.id,
        Math.min(from, to),
        from < to ? -1 : 1,
        Math.max(from, to),
        layer.id,
      ]);
      await op.tx.query('UPDATE layers SET position = $2 WHERE id = $1', [layer.id, to]);
    }
    await op.tx.query('UPDATE layers SET opacity = COALESCE($2, opacity), blend = COALESCE($3, blend), visible = COALESCE($4, visible) WHERE id = $1', [
      layer.id,
      body.opacity ?? null,
      body.blend ?? null,
      body.visible ?? null,
    ]);
    return { seq: await op.emit('layer', await layersPatch(op)) };
  }),
);

/** Taking or releasing a lock is a layer operation with its own sequence number (brief: Order). */
function setLock(ctx: Ctx, take: boolean) {
  return runOperation(ctx.need().id, asId(ctx.params.id), 'artwork', async (op) => {
    const layer = await layerOf(op, ctx.params.layer);
    if (take) {
      const holder = await lockedByOther(layer, op.userId);
      if (holder !== null) throw conflict('layer_locked', { message: `Locked by ${holder}` });
    } else if (layer.locked_by !== null && layer.locked_by !== op.userId && op.role !== 'owner') throw forbidden('Only the holder or the owner can unlock');
    await op.tx.query('UPDATE layers SET locked_by = $2 WHERE id = $1', [layer.id, take ? op.userId : null]);
    const seq = await op.emit('layer', await layersPatch(op));
    return take ? { locked_by: op.userName, seq } : { seq };
  });
}

route('POST', '/api/sprites/:id/layers/:layer/lock', (ctx) => setLock(ctx, true));
route('DELETE', '/api/sprites/:id/layers/:layer/lock', (ctx) => setLock(ctx, false));

route('POST', '/api/sprites/:id/layers/:layer/merge-down', (ctx) =>
  runOperation(ctx.need().id, asId(ctx.params.id), 'artwork', async (op) => {
    const upper = await layerOf(op, ctx.params.layer);
    const layers = await rows<LayerRow>(op.tx, 'SELECT id, name, opacity, blend, visible, locked_by, position FROM layers WHERE sprite_id = $1 ORDER BY position', [op.sprite.id]);
    const lower = layers.find((l) => l.position === upper.position + 1);
    if (!lower) throw invalid({ layer: 'No layer below' });
    for (const layer of [upper, lower]) {
      const holder = await lockedByOther(layer, op.userId);
      if (holder !== null) throw conflict('layer_locked', { message: `Locked by ${holder}` });
    }
    const swatches = (await loadSwatches(op.tx, op.sprite.palette_id)).filter((s) => !s.removed);
    const colours = colourTable(swatches.map((s) => ({ index: s.idx, color: s.color })));
    const existing = new Map<string, number>();
    for (const swatch of swatches) if (!existing.has(swatch.color)) existing.set(swatch.color, swatch.idx);
    const frames = await rows<{ id: number }>(op.tx, 'SELECT id FROM frames WHERE sprite_id = $1 ORDER BY position', [op.sprite.id]);
    const celData = async (frameId: number, layerId: number): Promise<Uint8Array | null> => {
      const cel = await one<{ data: Buffer }>(op.tx, 'SELECT b.data FROM cels c JOIN buffers b ON b.id = c.buffer_id WHERE c.frame_id = $1 AND c.layer_id = $2', [frameId, layerId]);
      return cel ? new Uint8Array(cel.data) : null;
    };
    const results: { frameId: number; colours: string[] }[] = [];
    const fresh: string[] = [];
    for (const frame of frames) {
      const [below, above] = [await celData(frame.id, lower.id), await celData(frame.id, upper.id)];
      if (!below && !above) continue;
      const rgba = compositeFrame(
        op.sprite.width,
        op.sprite.height,
        [
          { opacity: lower.opacity, blend: lower.blend, visible: true, cel: below },
          { opacity: upper.opacity, blend: upper.blend, visible: true, cel: above },
        ],
        colours,
      );
      const cells = Array.from({ length: op.sprite.width * op.sprite.height }, (_, p) => colourText(rgba[p * 4] ?? 0, rgba[p * 4 + 1] ?? 0, rgba[p * 4 + 2] ?? 0, rgba[p * 4 + 3] ?? 0));
      for (const colour of cells) if (!colour.endsWith('00') && !existing.has(colour) && !fresh.includes(colour)) fresh.push(colour);
      results.push({ frameId: frame.id, colours: cells });
    }
    const free = config.limits.paletteMax - swatches.length;
    if (fresh.length > free) {
      const format = ctx.locale.number_format;
      throw conflict('palette_full', { message: `Needs ${formatNumber(fresh.length, format)} new swatches, ${formatNumber(free, format)} free` });
    }
    const added = await addSwatches(op, fresh, ctx.locale, 'color');
    const indexOf = new Map(existing);
    fresh.forEach((colour, i) => indexOf.set(colour, added[i]?.idx ?? 0));
    for (const result of results) {
      const data = Buffer.from(result.colours.map((colour) => (colour.endsWith('00') && colour.slice(6) === '00' ? 0 : (indexOf.get(colour) ?? 0))));
      await createCel(op.tx, op.sprite, result.frameId, lower.id, new Uint8Array(data));
    }
    await op.tx.query('DELETE FROM layers WHERE id = $1', [upper.id]);
    await op.tx.query('UPDATE layers SET position = position - 1 WHERE sprite_id = $1 AND position > $2', [op.sprite.id, upper.position]);
    await op.tx.query("UPDATE layers SET opacity = 100, blend = 'normal' WHERE id = $1", [lower.id]);
    await dropUnused(op);
    await clearUndo(op.tx, op.sprite.id);
    const seq = await op.emit('layer', { refresh: true, notice: { kind: 'merged', layer: lower.name, count: added.length } });
    return { seq, new_swatches: added.length };
  }),
);

route('POST', '/api/sprites/:id/frames', (ctx) =>
  runOperation(ctx.need().id, asId(ctx.params.id), 'artwork', async (op) => {
    const body = objectBody(ctx.body);
    const total = (await one<{ n: number }>(op.tx, 'SELECT count(*)::int AS n FROM frames WHERE sprite_id = $1', [op.sprite.id]))?.n ?? 0;
    const errors = new Errors();
    const duration = body.duration_ms ?? Math.min(config.limits.frameMaxMs, Math.max(config.limits.frameMinMs, 100));
    durationCheck(errors, duration, ctx.locale);
    const position = body.position ?? total + 1;
    if (!intIn(position, 1, total + 1)) errors.add('position', `Use 1 to ${formatNumber(total + 1, ctx.locale.number_format)}`);
    errors.check();
    await op.tx.query('UPDATE frames SET position = position + 1 WHERE sprite_id = $1 AND position >= $2', [op.sprite.id, position]);
    await op.tx.query('INSERT INTO frames (sprite_id, position, duration_ms) VALUES ($1, $2, $3)', [op.sprite.id, position, duration]);
    const seq = await op.emit('frame', { frames: await frameInfos(op.tx, op.sprite.id) });
    return created({ number: position, seq });
  }),
);

function durationCheck(errors: Errors, value: unknown, locale: Locale): void {
  const { frameMinMs, frameMaxMs } = config.limits;
  if (!intIn(value, frameMinMs, frameMaxMs)) {
    const format = locale.number_format;
    errors.add('duration_ms', `Use ${formatNumber(frameMinMs, format)} to ${formatNumber(frameMaxMs, format)} ms`);
  }
}

route('PATCH', '/api/sprites/:id/frames/:n', (ctx) =>
  runOperation(ctx.need().id, asId(ctx.params.id), 'artwork', async (op) => {
    const frame = await one<{ id: number; position: number }>(op.tx, 'SELECT id, position FROM frames WHERE sprite_id = $1 AND position = $2', [op.sprite.id, asId(ctx.params.n)]);
    if (!frame) throw notFound();
    const body = objectBody(ctx.body);
    const total = (await one<{ n: number }>(op.tx, 'SELECT count(*)::int AS n FROM frames WHERE sprite_id = $1', [op.sprite.id]))?.n ?? 0;
    const errors = new Errors();
    if (body.duration_ms !== undefined) durationCheck(errors, body.duration_ms, ctx.locale);
    if (body.position !== undefined && !intIn(body.position, 1, total)) errors.add('position', `Use 1 to ${formatNumber(total, ctx.locale.number_format)}`);
    errors.check();
    if (typeof body.position === 'number' && body.position !== frame.position) {
      const to = body.position;
      await op.tx.query('UPDATE frames SET position = position + $3 WHERE sprite_id = $1 AND position BETWEEN $2 AND $4 AND id <> $5', [
        op.sprite.id,
        Math.min(frame.position, to),
        frame.position < to ? -1 : 1,
        Math.max(frame.position, to),
        frame.id,
      ]);
      await op.tx.query('UPDATE frames SET position = $2 WHERE id = $1', [frame.id, to]);
    }
    if (typeof body.duration_ms === 'number') await op.tx.query('UPDATE frames SET duration_ms = $2 WHERE id = $1', [frame.id, body.duration_ms]);
    return { seq: await op.emit('frame', { frames: await frameInfos(op.tx, op.sprite.id) }) };
  }),
);

async function celTarget(op: Operation, number: string | undefined, layerRef: unknown): Promise<{ frame: { id: number; position: number }; layer: LayerRow }> {
  const frame = await one<{ id: number; position: number }>(op.tx, 'SELECT id, position FROM frames WHERE sprite_id = $1 AND position = $2', [op.sprite.id, asId(number)]);
  if (!frame) throw notFound();
  const layers = await rows<LayerRow>(op.tx, 'SELECT id, name, opacity, blend, visible, locked_by, position FROM layers WHERE sprite_id = $1', [op.sprite.id]);
  const layer = layers.find((l) => l.name === layerRef || l.id === layerRef);
  if (!layer) throw invalid({ layer: 'Choose a layer of this sprite' });
  const holder = await lockedByOther(layer, op.userId);
  if (holder !== null) throw conflict('layer_locked', { message: `Locked by ${holder}` });
  return { frame, layer };
}

const dropUnused = (op: Operation): Promise<unknown> =>
  op.tx.query('DELETE FROM buffers WHERE sprite_id = $1 AND id NOT IN (SELECT buffer_id FROM cels)', [op.sprite.id]);

route('POST', '/api/sprites/:id/frames/:n/cels/link', (ctx) =>
  runOperation(ctx.need().id, asId(ctx.params.id), 'artwork', async (op) => {
    const body = objectBody(ctx.body);
    const { frame, layer } = await celTarget(op, ctx.params.n, body.layer);
    const total = (await one<{ n: number }>(op.tx, 'SELECT count(*)::int AS n FROM frames WHERE sprite_id = $1', [op.sprite.id]))?.n ?? 0;
    if (!intIn(body.to_frame, 1, total) || body.to_frame === frame.position) throw invalid({ to_frame: 'Choose another frame of this sprite' });
    const source = await one<{ id: number }>(op.tx, 'SELECT id FROM frames WHERE sprite_id = $1 AND position = $2', [op.sprite.id, body.to_frame]);
    const patch: { buffers: { id: number }[]; cels: { frame: number; layer: number; buffer: number }[] } = { buffers: [], cels: [] };
    let buffer = (await one<{ buffer_id: number }>(op.tx, 'SELECT buffer_id FROM cels WHERE frame_id = $1 AND layer_id = $2', [source?.id, layer.id]))?.buffer_id;
    if (buffer === undefined) {
      buffer = await createCel(op.tx, op.sprite, source?.id ?? 0, layer.id);
      patch.buffers.push({ id: buffer });
      patch.cels.push({ frame: source?.id ?? 0, layer: layer.id, buffer });
    }
    await op.tx.query(
      'INSERT INTO cels (frame_id, layer_id, buffer_id) VALUES ($1, $2, $3) ON CONFLICT (frame_id, layer_id) DO UPDATE SET buffer_id = $3',
      [frame.id, layer.id, buffer],
    );
    patch.cels.push({ frame: frame.id, layer: layer.id, buffer });
    await dropUnused(op);
    await clearStale(op);
    return { seq: await op.emit('cel', { ...patch, counts: await op.counts() }) };
  }),
);

/** Undo entries that point at buffers that no longer exist cannot be applied: drop them. */
async function clearStale(op: Operation): Promise<void> {
  const stale = await rows<{ id: number; changes: [string, number][] }>(op.tx, 'SELECT id, changes FROM undo_entries WHERE sprite_id = $1', [op.sprite.id]);
  const live = new Set((await rows<{ id: number }>(op.tx, 'SELECT id FROM buffers WHERE sprite_id = $1', [op.sprite.id])).map((b) => b.id));
  const gone = stale.filter((entry) => entry.changes.some((c) => c[0] === 'cel' && !live.has(c[1]))).map((entry) => entry.id);
  if (gone.length > 0) await op.tx.query('DELETE FROM undo_entries WHERE id = ANY($1)', [gone]);
}

route('POST', '/api/sprites/:id/frames/:n/cels/unlink', (ctx) =>
  runOperation(ctx.need().id, asId(ctx.params.id), 'artwork', async (op) => {
    const { frame, layer } = await celTarget(op, ctx.params.n, objectBody(ctx.body).layer);
    const cel = await one<{ buffer_id: number; data: Buffer }>(
      op.tx,
      'SELECT c.buffer_id, b.data FROM cels c JOIN buffers b ON b.id = c.buffer_id WHERE c.frame_id = $1 AND c.layer_id = $2',
      [frame.id, layer.id],
    );
    const shared = cel
      ? (await one<{ n: number }>(op.tx, 'SELECT count(*)::int AS n FROM cels WHERE layer_id = $1 AND buffer_id = $2', [layer.id, cel.buffer_id]))?.n ?? 0
      : 0;
    if (!cel || shared < 2) throw conflict('not_linked');
    const buffer = await createCel(op.tx, op.sprite, frame.id, layer.id, new Uint8Array(cel.data));
    return {
      seq: await op.emit('cel', {
        buffers: [{ id: buffer, data: cel.data.toString('base64') }],
        cels: [{ frame: frame.id, layer: layer.id, buffer }],
        counts: await op.counts(),
      }),
    };
  }),
);

route('POST', '/api/sprites/:id/tags', (ctx) =>
  runOperation(ctx.need().id, asId(ctx.params.id), 'artwork', async (op) => {
    const body = objectBody(ctx.body);
    const total = (await one<{ n: number }>(op.tx, 'SELECT count(*)::int AS n FROM frames WHERE sprite_id = $1', [op.sprite.id]))?.n ?? 0;
    const errors = new Errors();
    const format = ctx.locale.number_format;
    if (nameOf(body.name) === '' || nameOf(body.name).length > 80) errors.add('name', 'Name the tag in up to 80 characters');
    if (!intIn(body.from, 1, total)) errors.add('from', `Use 1 to ${formatNumber(total, format)}`);
    if (!intIn(body.to, 1, total)) errors.add('to', `Use 1 to ${formatNumber(total, format)}`);
    else if (isInt(body.from) && body.to < body.from) errors.add('to', 'Use a frame at or after the first');
    if (!DIRECTIONS.includes(body.direction as Direction)) errors.add('direction', `Use ${DIRECTIONS.join(', ')}`);
    const repeat = body.repeat ?? 0;
    if (!intIn(repeat, 0, TAG_REPEAT_MAX)) errors.add('repeat', `Use 0 to ${TAG_REPEAT_MAX}`);
    errors.check();
    const tag = await one<{ id: number }>(
      op.tx,
      'INSERT INTO tags (sprite_id, name, from_frame, to_frame, direction, repeat) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [op.sprite.id, nameOf(body.name), body.from, body.to, body.direction, repeat],
    );
    await op.tx.query("INSERT INTO drafts (user_id, key, text, version) VALUES ($1, $2, '', 1) ON CONFLICT (user_id, key) DO UPDATE SET text = '', version = drafts.version + 1", [
      op.userId,
      `tag:${op.sprite.id}`,
    ]);
    return created({ id: tag?.id, seq: await op.emit('tag', { tags: await tagInfos(op.tx, op.sprite.id) }) });
  }),
);

route('DELETE', '/api/sprites/:id/tags/:tag', (ctx) =>
  runOperation(ctx.need().id, asId(ctx.params.id), 'artwork', async (op) => {
    const removed = await op.tx.query('DELETE FROM tags WHERE id = $1 AND sprite_id = $2', [asId(ctx.params.tag), op.sprite.id]);
    if (removed.rowCount === 0) throw notFound();
    return { seq: await op.emit('tag', { tags: await tagInfos(op.tx, op.sprite.id) }) };
  }),
);

/** The composite of a frame as rows of colour text, for a read-only link or the pixel route. */
export async function compositeRows(spriteId: number, number: number): Promise<{ width: number; height: number; seq: number; rows: string[][] } | null> {
  const sprite = await loadSpriteRow(pool, spriteId);
  const frame = sprite && (await one<{ id: number }>(pool, 'SELECT id FROM frames WHERE sprite_id = $1 AND position = $2', [spriteId, number]));
  if (!sprite || !frame) return null;
  const model = await loadModel(pool, sprite);
  return { width: sprite.width, height: sprite.height, seq: sprite.seq, rows: colourRows(frameRgba(model, frame.id), sprite.width, sprite.height) };
}
