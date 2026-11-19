import type { Express } from 'express';
import { q, one } from './db.js';
import { notFound, forbidden, conflict, fieldErrors } from './errors.js';
import { requireUser, config } from './http.js';
import { getSprite, nextSeq } from './sprites.js';
import { requireMember } from './projects.js';
import { swatchCounts, paletteSwatches } from './render.js';
import { parsePaletteFile, rampColor, formatNumber } from '../shared/rules.js';

function artworkForbidden(role: string): void {
  if (role === 'reviewer') throw forbidden("Reviewers can't change artwork");
}

export function registerPaletteRoutes(app: Express): void {
  app.get('/api/palettes/:id', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const palette = await one<{ id: string; sprite_id: string }>('select id::text, sprite_id::text from palettes where id = $1', [req.params.id]);
      if (!palette) throw notFound();
      const sprite = await getSprite(palette.sprite_id);
      await requireMember(Number(sprite.project_id), user.id);
      const swatches = await paletteSwatches(Number(palette.id));
      const counts = await swatchCounts(Number(sprite.id));
      const editors = await q<{ index: number; name: string }>(
        'select s.index, u.name from swatches s left join users u on u.id = s.edited_by where s.palette_id = $1', [palette.id]
      );
      const editorBy = new Map(editors.map((e) => [e.index, e.name]));
      res.json({
        id: Number(palette.id),
        order: swatches.filter((s) => s.index !== 0).map((s) => s.index),
        swatches: swatches.map((s) => ({
          index: s.index, color: s.color, version: s.version,
          used_by: s.index === 0 ? 0 : (counts.get(s.index)?.usedBy ?? 0),
          frames: s.index === 0 ? 0 : (counts.get(s.index)?.framesBy.size ?? 0),
          edited_by: editorBy.get(s.index) ?? null
        }))
      });
    } catch (e) { next(e); }
  });

  app.post('/api/palettes/:id/swatches', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const palette = await one<{ id: string; sprite_id: string }>('select id::text, sprite_id::text from palettes where id = $1', [req.params.id]);
      if (!palette) throw notFound();
      const sprite = await getSprite(palette.sprite_id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      artworkForbidden(role);
      const color = String((req.body as Record<string, unknown>)['color'] ?? '');
      if (!/^[0-9a-f]{8}$/.test(color)) throw fieldErrors({ color: 'Use eight lowercase hex digits' });
      const existing = await paletteSwatches(Number(palette.id));
      let index = 1;
      const used = new Set(existing.map((s) => s.index));
      while (used.has(index)) index++;
      if (index > config.paletteMax) throw fieldErrors({ color: `Palette limit is ${formatNumber(config.paletteMax, 'en-US')} swatches` });
      await q('insert into swatches (palette_id, index, color, version, last_version, edited_by) values ($1, $2, $3, 1, 1, $4)',
        [palette.id, index, color, user.id]);
      const seq = await nextSeq(Number(sprite.id), 'palette', user.id, { op: 'add', index });
      res.status(201).json({ index, color, version: 1, seq });
    } catch (e) { next(e); }
  });

  app.patch('/api/palettes/:id/swatches/:index', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const palette = await one<{ id: string; sprite_id: string }>('select id::text, sprite_id::text from palettes where id = $1', [req.params.id]);
      if (!palette) throw notFound();
      const sprite = await getSprite(palette.sprite_id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      artworkForbidden(role);
      const index = Number(req.params.index);
      if (index === 0) throw fieldErrors({ index: 'Index 0 is transparent' });
      const body = req.body as Record<string, unknown>;
      const color = String(body['color'] ?? '');
      const version = Number(body['version']);
      if (!/^[0-9a-f]{8}$/.test(color)) throw fieldErrors({ color: 'Use eight lowercase hex digits' });
      const swatch = await one<{ index: number; color: string; version: number; last_version: number; edited_by: string | null }>(
        'select index, color, version, last_version, edited_by::text from swatches where palette_id = $1 and index = $2',
        [palette.id, index]
      );
      if (!swatch) {
        const remover = await one<{ name: string }>(
          `select u.name from activity a join users u on u.id = a.by
           where a.sprite_id = $1 and a.kind = 'swatch_remove' and a.detail = $2 order by a.id desc limit 1`,
          [sprite.id, String(index)]
        );
        throw conflict('swatch_removed', { message: `${remover?.name ?? 'Someone'} removed this swatch first` });
      }
      if (version !== swatch.last_version) {
        throw conflict('version_conflict', { current: { index, color: swatch.color, version: swatch.last_version } });
      }
      await q('update swatches set color = $1, version = version + 1, last_version = last_version + 1, edited_by = $2 where palette_id = $3 and index = $4',
        [color, user.id, palette.id, index]);
      const counts = await swatchCounts(Number(sprite.id));
      const seq = await nextSeq(Number(sprite.id), 'swatch', user.id, { index, color });
      res.json({
        index, color, version: swatch.version + 1,
        used_by: counts.get(index)?.usedBy ?? 0,
        frames: counts.get(index)?.framesBy.size ?? 0,
        seq
      });
    } catch (e) { next(e); }
  });

  app.delete('/api/palettes/:id/swatches/:index', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const palette = await one<{ id: string; sprite_id: string }>('select id::text, sprite_id::text from palettes where id = $1', [req.params.id]);
      if (!palette) throw notFound();
      const sprite = await getSprite(palette.sprite_id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      artworkForbidden(role);
      const index = Number(req.params.index);
      if (index === 0) throw fieldErrors({ index: 'Index 0 is transparent' });
      const counts = await swatchCounts(Number(sprite.id));
      const usedBy = counts.get(index)?.usedBy ?? 0;
      if (usedBy > 0) throw conflict('swatch_in_use', { message: `Used by ${formatNumber(usedBy, 'en-US')} pixels` });
      const swatch = await one<{ index: number }>('select index from swatches where palette_id = $1 and index = $2', [palette.id, index]);
      if (!swatch) throw fieldErrors({ index: 'No such swatch' });
      await q('delete from swatches where palette_id = $1 and index = $2', [palette.id, index]);
      const seq = await nextSeq(Number(sprite.id), 'palette', user.id, { op: 'remove', index });
      res.json({ seq });
    } catch (e) { next(e); }
  });

  app.patch('/api/palettes/:id/order', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const palette = await one<{ id: string; sprite_id: string }>('select id::text, sprite_id::text from palettes where id = $1', [req.params.id]);
      if (!palette) throw notFound();
      const sprite = await getSprite(palette.sprite_id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      artworkForbidden(role);
      const body = req.body as Record<string, unknown>;
      const order = body['order'];
      const existing = (await paletteSwatches(Number(palette.id))).map((s) => s.index);
      const wanted = Array.isArray(order) ? (order as unknown[]).map(Number) : null;
      if (!wanted || wanted.length !== existing.length || !existing.every((i) => wanted.includes(i))) {
        throw fieldErrors({ order: 'Use every swatch index once' });
      }
      const seq = await nextSeq(Number(sprite.id), 'palette', user.id, { op: 'order' });
      res.json({ seq });
    } catch (e) { next(e); }
  });

  app.post('/api/palettes/:id/ramp', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const palette = await one<{ id: string; sprite_id: string }>('select id::text, sprite_id::text from palettes where id = $1', [req.params.id]);
      if (!palette) throw notFound();
      const sprite = await getSprite(palette.sprite_id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      artworkForbidden(role);
      const body = req.body as Record<string, unknown>;
      const from = Number(body['from']);
      const to = Number(body['to']);
      const steps = Number(body['steps']);
      const errors: Record<string, string> = {};
      if (!Number.isInteger(steps) || steps < 3 || steps > 32) errors['steps'] = 'Use 3 to 32 steps';
      if (from === 0) errors['from'] = 'Index 0 is transparent';
      if (to === 0) errors['to'] = 'Index 0 is transparent';
      const swatches = await paletteSwatches(Number(palette.id));
      const fromSwatch = swatches.find((s) => s.index === from);
      const toSwatch = swatches.find((s) => s.index === to);
      if (!fromSwatch && !errors['from']) errors['from'] = 'No such swatch';
      if (!toSwatch && !errors['to']) errors['to'] = 'No such swatch';
      const need = steps - 2;
      const freeCount = countFree(swatches);
      if (need > freeCount) errors['steps'] = `Palette limit is ${formatNumber(config.paletteMax, 'en-US')} swatches`;
      if (Object.keys(errors).length) throw fieldErrors(errors);
      const added: { index: number; color: string; version: number }[] = [];
      for (let i = 1; i <= steps - 2; i++) {
        const color = rampColor(fromSwatch!.color, toSwatch!.color, i, steps);
        const index = lowestFree(swatches);
        await q('insert into swatches (palette_id, index, color, version, last_version, edited_by) values ($1, $2, $3, 1, 1, $4)',
          [palette.id, index, color, user.id]);
        swatches.push({ index, color, version: 1, edited_by: null });
        added.push({ index, color, version: 1 });
      }
      const seq = await nextSeq(Number(sprite.id), 'palette', user.id, { op: 'ramp' });
      res.status(201).json({ swatches: added, seq });
    } catch (e) { next(e); }
  });

  app.post('/api/palettes/:id/import', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const palette = await one<{ id: string; sprite_id: string }>('select id::text, sprite_id::text from palettes where id = $1', [req.params.id]);
      if (!palette) throw notFound();
      const sprite = await getSprite(palette.sprite_id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      artworkForbidden(role);
      const body = req.body as Record<string, unknown>;
      const fileName = String(body['file_name'] ?? '');
      const text = String(body['text'] ?? '');
      const parsed = parsePaletteFile(fileName, text);
      if (parsed.error) throw fieldErrors({ file: parsed.error.text });
      const swatches = await paletteSwatches(Number(palette.id));
      if (swatches.length + parsed.colors.length > config.paletteMax + 1) {
        throw fieldErrors({ file: `Palette limit is ${formatNumber(config.paletteMax, 'en-US')} swatches` });
      }
      for (const color of parsed.colors) {
        const index = lowestFree(swatches);
        await q('insert into swatches (palette_id, index, color, version, last_version, edited_by) values ($1, $2, $3, 1, 1, $4)',
          [palette.id, index, color, user.id]);
        swatches.push({ index, color, version: 1, edited_by: null });
      }
      const seq = await nextSeq(Number(sprite.id), 'palette', user.id, { op: 'import' });
      res.status(201).json({ added: parsed.colors.length, seq });
    } catch (e) { next(e); }
  });
}

function countFree(swatches: { index: number }[]): number {
  const used = new Set(swatches.map((s) => s.index));
  let free = 0;
  for (let i = 1; i <= config.paletteMax; i++) if (!used.has(i)) free++;
  return free;
}

function lowestFree(swatches: { index: number }[]): number {
  const used = new Set(swatches.map((s) => s.index));
  for (let i = 1; i <= config.paletteMax; i++) if (!used.has(i)) return i;
  throw conflict('palette_full', { message: 'Palette is full' });
}
