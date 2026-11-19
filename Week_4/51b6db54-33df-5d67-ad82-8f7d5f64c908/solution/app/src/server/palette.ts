import { asId, spriteAccess } from './access';
import { config } from './config';
import { one, pool } from './db';
import { conflict, invalid, notFound } from './errors';
import { created, route } from './http';
import { swatchInfos } from './infos';
import { loadCounts, loadSwatches, type SwatchRow } from './model';
import { cursorOf } from './hub';
import { recordActivity, runOperation, type Change, type Operation } from './ops';
import { Errors, intIn, isInt, objectBody } from './validate';
import { isColour } from '../shared/colour';
import { counted, formatNumber } from '../shared/format';
import { parsePaletteFile, rampColours } from '../shared/palette';

async function paletteSprite(userId: number, paletteId: number): Promise<number> {
  const found = await one<{ id: number }>(pool, 'SELECT id FROM sprites WHERE palette_id = $1', [paletteId]);
  if (!found) throw notFound();
  await spriteAccess(userId, found.id);
  return found.id;
}

route('GET', '/api/palettes/:id', async (ctx) => {
  const paletteId = asId(ctx.params.id);
  const spriteId = await paletteSprite(ctx.need().id, paletteId);
  const swatches = await swatchInfos(await loadSwatches(pool, paletteId));
  const counts = await loadCounts(pool, spriteId);
  const order = (await one<{ ord: number[] }>(pool, 'SELECT ord FROM palettes WHERE id = $1', [paletteId]))?.ord ?? [];
  return {
    id: paletteId,
    order,
    swatches: swatches.map((s) => ({
      index: s.index,
      color: s.color,
      version: s.version,
      used_by: counts.pixels[s.index] ?? 0,
      frames: counts.frames[s.index] ?? 0,
      edited_by: s.edited_by,
    })),
  };
});

const paletteFor = async (op: Operation): Promise<SwatchRow[]> => loadSwatches(op.tx, op.sprite.palette_id);

/** Adds swatches at the lowest free indices, continuing the versions of indices that were removed. */
export async function addSwatches(op: Operation, colours: readonly string[], locale: { number_format: 'en-US' | 'en-IN' }, field: string): Promise<SwatchRow[]> {
  const all = await paletteFor(op);
  const live = new Set(all.filter((s) => !s.removed).map((s) => s.idx));
  const { paletteMax } = config.limits;
  if (live.size + colours.length > paletteMax) throw invalid({ [field]: `Palette limit is ${formatNumber(paletteMax, locale.number_format)} swatches` });
  const added: SwatchRow[] = [];
  let next = 1;
  for (const color of colours) {
    while (live.has(next)) next += 1;
    live.add(next);
    const last = all.find((s) => s.idx === next);
    const version = (last?.version ?? 0) + 1;
    await op.tx.query(
      `INSERT INTO swatches (palette_id, idx, color, version, edited_by, removed) VALUES ($1, $2, $3, $4, $5, false)
       ON CONFLICT (palette_id, idx) DO UPDATE SET color = $3, version = $4, edited_by = $5, removed = false, removed_by = NULL`,
      [op.sprite.palette_id, next, color, version, op.userId],
    );
    added.push({ idx: next, color, version, edited_by: op.userId, removed: false, removed_by: null });
  }
  await op.tx.query('UPDATE palettes SET ord = ord || $2::int[] WHERE id = $1', [op.sprite.palette_id, added.map((s) => s.idx)]);
  return added;
}

const paletteEvent = async (op: Operation, changed: readonly number[] = []): Promise<number> => {
  const all = await loadSwatches(op.tx, op.sprite.palette_id);
  const order = (await one<{ ord: number[] }>(op.tx, 'SELECT ord FROM palettes WHERE id = $1', [op.sprite.palette_id]))?.ord ?? [];
  const infos = await swatchInfos(all.filter((s) => changed.includes(s.idx) || s.removed));
  const removed = all.filter((s) => s.removed).map((s) => ({ index: s.idx, color: s.color, version: s.version, edited_by: null, removed: true }));
  return op.emit('palette', { swatches: [...infos.filter((s) => !s.removed), ...removed], order, counts: await op.counts() });
};

route('POST', '/api/palettes/:id/swatches', async (ctx) => {
  const user = ctx.need();
  const spriteId = await paletteSprite(user.id, asId(ctx.params.id));
  return runOperation(user.id, spriteId, 'artwork', async (op) => {
    const color = objectBody(ctx.body).color;
    if (!isColour(color)) throw invalid({ color: 'Use eight lowercase hex digits' });
    const [swatch] = await addSwatches(op, [color], ctx.locale, 'color');
    const seq = await paletteEvent(op, [swatch?.idx ?? 0]);
    return created({ index: swatch?.idx, color, version: swatch?.version, seq });
  });
});

route('PATCH', '/api/palettes/:id/swatches/:index', async (ctx) => {
  const user = ctx.need();
  const paletteId = asId(ctx.params.id);
  const spriteId = await paletteSprite(user.id, paletteId);
  return runOperation(user.id, spriteId, 'artwork', async (op) => {
    const index = Number(ctx.params.index);
    if (index === 0) throw invalid({ index: 'Index 0 is transparent' });
    if (!Number.isInteger(index) || index < 0) throw invalid({ index: 'Use a swatch index' });
    const swatch = (await paletteFor(op)).find((s) => s.idx === index);
    if (!swatch) throw invalid({ index: `Swatch ${index} does not exist` });
    if (swatch.removed) {
      const remover = swatch.removed_by === null ? '' : ((await one<{ name: string }>(op.tx, 'SELECT name FROM users WHERE id = $1', [swatch.removed_by]))?.name ?? '');
      throw conflict('swatch_removed', { message: `${remover} removed this swatch first` });
    }
    const body = objectBody(ctx.body);
    if (!isInt(body.version)) throw invalid({ version: 'Send the version you edited' });
    if (body.version !== swatch.version) throw conflict('version_conflict', { current: { index, color: swatch.color, version: swatch.version } });
    if (!isColour(body.color)) throw invalid({ color: 'Use eight lowercase hex digits' });
    const updated = await one<{ version: number }>(
      op.tx,
      'UPDATE swatches SET color = $3, version = version + 1, edited_by = $4 WHERE palette_id = $1 AND idx = $2 RETURNING version',
      [op.sprite.palette_id, index, body.color, op.userId],
    );
    const counts = await op.counts();
    const cursor = cursorOf(op.sprite.id, op.userId);
    const info = { index, color: body.color, version: updated?.version ?? 0, edited_by: op.userName };
    const changes: Change[] = [['swatch', op.sprite.palette_id, index, swatch.color, body.color]];
    const seq = await op.emit(
      'swatch',
      { swatches: [info], counts, flood: { index, color: body.color, cursor: [cursor.x, cursor.y], used_by: counts.pixels[index] ?? 0, frames: counts.frames[index] ?? 0 } },
      changes,
    );
    await op.recordUndo(seq, changes);
    await recordActivity(op.tx, op.sprite.project_id, op.userId, op.sprite.id, { kind: 'swatch', data: { index } });
    return { index, color: body.color, version: info.version, used_by: counts.pixels[index] ?? 0, frames: counts.frames[index] ?? 0, seq };
  });
});

route('DELETE', '/api/palettes/:id/swatches/:index', async (ctx) => {
  const user = ctx.need();
  const spriteId = await paletteSprite(user.id, asId(ctx.params.id));
  return runOperation(user.id, spriteId, 'artwork', async (op) => {
    const index = Number(ctx.params.index);
    if (index === 0) throw invalid({ index: 'Index 0 is transparent' });
    const swatch = (await paletteFor(op)).find((s) => s.idx === index);
    if (!isInt(index) || !swatch || swatch.removed) throw invalid({ index: `Swatch ${String(ctx.params.index)} does not exist` });
    const used = (await op.counts()).pixels[index] ?? 0;
    if (used > 0) throw conflict('swatch_in_use', { message: `Used by ${counted(used, 'pixel', ctx.locale.number_format)}` });
    await op.tx.query('UPDATE swatches SET removed = true, removed_by = $3 WHERE palette_id = $1 AND idx = $2', [op.sprite.palette_id, index, op.userId]);
    await op.tx.query('UPDATE palettes SET ord = array_remove(ord, $2) WHERE id = $1', [op.sprite.palette_id, index]);
    return { seq: await paletteEvent(op) };
  });
});

route('PATCH', '/api/palettes/:id/order', async (ctx) => {
  const user = ctx.need();
  const spriteId = await paletteSprite(user.id, asId(ctx.params.id));
  return runOperation(user.id, spriteId, 'artwork', async (op) => {
    const order = objectBody(ctx.body).order;
    const live = (await paletteFor(op)).filter((s) => !s.removed).map((s) => s.idx);
    const valid = Array.isArray(order) && order.length === live.length && order.every((i) => live.includes(i as number)) && new Set(order).size === order.length;
    if (!valid) throw invalid({ order: 'List every swatch once' });
    await op.tx.query('UPDATE palettes SET ord = $2::int[] WHERE id = $1', [op.sprite.palette_id, order]);
    return { seq: await paletteEvent(op) };
  });
});

route('POST', '/api/palettes/:id/ramp', async (ctx) => {
  const user = ctx.need();
  const spriteId = await paletteSprite(user.id, asId(ctx.params.id));
  return runOperation(user.id, spriteId, 'artwork', async (op) => {
    const body = objectBody(ctx.body);
    const errors = new Errors();
    const all = await paletteFor(op);
    const end = (field: 'from' | 'to'): string => {
      const index = body[field];
      if (index === 0) errors.add(field, 'Index 0 is transparent');
      const found = all.find((s) => s.idx === index && !s.removed);
      if (!found && index !== 0) errors.add(field, 'Choose a swatch of this palette');
      return found?.color ?? '00000000';
    };
    const from = end('from');
    const to = end('to');
    if (!intIn(body.steps, 3, 32)) errors.add('steps', 'Use 3 to 32');
    errors.check();
    const colours = rampColours(from, to, body.steps as number).slice(1, -1);
    const added = await addSwatches(op, colours, ctx.locale, 'color');
    const seq = await paletteEvent(op, added.map((s) => s.idx));
    return created({ swatches: added.map((s) => ({ index: s.idx, color: s.color, version: s.version })), seq });
  });
});

route('POST', '/api/palettes/:id/import', async (ctx) => {
  const user = ctx.need();
  const spriteId = await paletteSprite(user.id, asId(ctx.params.id));
  return runOperation(user.id, spriteId, 'artwork', async (op) => {
    const body = objectBody(ctx.body);
    const parsed = parsePaletteFile(typeof body.file_name === 'string' ? body.file_name : '', typeof body.text === 'string' ? body.text : '');
    if ('error' in parsed) throw invalid({ file: parsed.error });
    const added = await addSwatches(op, parsed.colours, ctx.locale, 'color');
    const seq = await paletteEvent(op, added.map((s) => s.idx));
    return created({ added: added.length, seq });
  });
});

