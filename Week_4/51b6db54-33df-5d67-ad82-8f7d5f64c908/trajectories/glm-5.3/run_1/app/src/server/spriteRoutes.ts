import type { Express } from 'express';
import { q, one } from './db.js';
import { notFound, forbidden, conflict, fieldErrors } from './errors.js';
import { now } from './clock.js';
import { requireUser, config } from './http.js';
import {
  getSprite, getLayers, getFrames, celRows, writeCel, blankRows, nextSeq,
  clearAllUndo, type LayerRow
} from './sprites.js';
import { requireMember, recordActivity } from './projects.js';
import { frameComposite, paletteSwatches, swatchCounts } from './render.js';
import { bytesToHex, composite, formatNumber, tagSequence, makeColorOf } from '../shared/rules.js';

function layerChangesForbidden(role: string): void {
  if (role === 'reviewer') throw forbidden("Reviewers can't change artwork");
}

export function registerSpriteRoutes(app: Express): void {
  app.post('/api/projects/:id/sprites', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const role = await requireMember(Number(req.params.id), user.id);
      layerChangesForbidden(role);
      const body = req.body as Record<string, unknown>;
      const name = String(body['name'] ?? '').trim();
      const width = Number(body['width']);
      const height = Number(body['height']);
      const errors: Record<string, string> = {};
      if (!Number.isInteger(width) || width < 1 || width > config.spriteMax) errors['width'] = `Largest size is ${formatNumber(config.spriteMax, 'en-US')}`;
      if (!Number.isInteger(height) || height < 1 || height > config.spriteMax) errors['height'] = `Largest size is ${formatNumber(config.spriteMax, 'en-US')}`;
      if (!name) errors['name'] = 'Write a sprite name';
      if (Object.keys(errors).length) throw fieldErrors(errors);
      const at = await now();
      const palette = await one<{ id: string }>('insert into palettes (sprite_id, seq_at_creation) values (0, 0) returning id::text');
      const sprite = await one<{ id: string }>(
        'insert into sprites (project_id, palette_id, name, width, height, seq, created_at) values ($1, $2, $3, $4, $5, 0, $6) returning id::text',
        [req.params.id, palette!.id, name, width, height, at]
      );
      await q('update palettes set sprite_id = $1 where id = $2', [sprite!.id, palette!.id]);
      await q('insert into layers (sprite_id, name, opacity, blend, visible, locked_by, position) values ($1, $2, 100, $3, true, null, 1)',
        [sprite!.id, 'Layer 1', 'normal']);
      await q('insert into frames (sprite_id, position, duration_ms) values ($1, 1, 100)', [sprite!.id]);
      res.status(201).json({ id: Number(sprite!.id), palette: Number(palette!.id), seq: 0 });
    } catch (e) { next(e); }
  });

  app.get('/api/sprites/:id', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      await requireMember(Number(sprite.project_id), user.id);
      const layers = await getLayers(Number(sprite.id));
      const frames = await getFrames(Number(sprite.id));
      const tags = await q<{ id: string; name: string; from_frame: number; to_frame: number; direction: string; repeat: number }>(
        'select id::text, name, from_frame, to_frame, direction, repeat from tags where sprite_id = $1 order by id asc', [sprite.id]
      );
      const tilesets = await q<{ id: string }>('select id::text from tilesets where sprite_id = $1 order by id asc', [sprite.id]);
      const tilemaps = await q<{ id: string }>('select id::text from tilemaps where sprite_id = $1 order by id asc', [sprite.id]);
      const framesOut = [];
      for (const frame of frames) {
        const linkedLayers: number[] = [];
        for (const layer of layers) {
          const link = await one<{ link_frame_id: string | null }>(
            'select link_frame_id::text from cels where frame_id = $1 and layer_id = $2', [frame.id, layer.id]
          );
          if (link?.link_frame_id) {
            const other = frames.find((f) => f.id === link.link_frame_id);
            linkedLayers.push(other ? other.position : 0);
          }
        }
        framesOut.push({ number: frame.position, duration_ms: frame.duration_ms, linked_layers: linkedLayers });
      }
      res.json({
        id: Number(sprite.id), name: sprite.name, width: sprite.width, height: sprite.height,
        seq: sprite.seq, palette: Number(sprite.palette_id),
        layers: layers.map((l) => ({
          id: Number(l.id), name: l.name, opacity: l.opacity, blend: l.blend,
          visible: l.visible,
          locked_by: l.locked_by ? Number(l.locked_by) : null,
          position: l.position
        })),
        frames: framesOut,
        tags: tags.map((t) => ({ id: Number(t.id), name: t.name, from: t.from_frame, to: t.to_frame, direction: t.direction, repeat: t.repeat })),
        tilesets: tilesets.map((t) => Number(t.id)),
        tilemaps: tilemaps.map((t) => Number(t.id))
      });
    } catch (e) { next(e); }
  });

  app.get('/api/sprites/:id/frames/:n/pixels', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      await requireMember(Number(sprite.project_id), user.id);
      const framePos = Number(req.params.n);
      const layerName = req.query.layer as string | undefined;
      const swatches = await paletteSwatches(Number(sprite.palette_id));
      const colorOf = makeColorOf(swatches.map((s) => ({ index: s.index, color: s.color })));
      if (layerName) {
        const layers = await getLayers(Number(sprite.id));
        const frames = await getFrames(Number(sprite.id));
        const frame = frames.find((f) => f.position === framePos);
        const layer = layers.find((l) => l.name === layerName);
        if (!frame || !layer) throw fieldErrors({ layer: 'No such layer' });
        const rows = await celRows(Number(frame.id), Number(layer.id));
        // a cel always reads as the full sprite size, padded with transparent
        const full = blankRows(sprite.width, sprite.height);
        if (rows) {
          for (let y = 0; y < rows.length && y < full.length; y++) {
            for (let x = 0; x < rows[y].length && x < full[y].length; x++) full[y][x] = rows[y][x];
          }
        }
        res.json({
          width: sprite.width, height: sprite.height, seq: sprite.seq,
          rows: full.map((row) => row.map((idx) => idx === 0 ? '00000000' : colorOf(idx)))
        });
        return;
      }
      const { buf, w, h } = await frameComposite(Number(sprite.id), framePos);
      const rows: string[][] = [];
      for (let y = 0; y < h; y++) {
        const row: string[] = [];
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          row.push(bytesToHex(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]));
        }
        rows.push(row);
      }
      res.json({ width: w, height: h, seq: sprite.seq, rows });
    } catch (e) { next(e); }
  });

  app.get('/api/sprites/:id/frames/:n/indices', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      await requireMember(Number(sprite.project_id), user.id);
      const framePos = Number(req.params.n);
      const layerName = String(req.query.layer ?? '');
      const layers = await getLayers(Number(sprite.id));
      const frames = await getFrames(Number(sprite.id));
      const frame = frames.find((f) => f.position === framePos);
      const layer = layers.find((l) => l.name === layerName);
      if (!frame || !layer) throw fieldErrors({ layer: 'No such layer' });
      const link = await one<{ link_frame_id: string | null }>(
        'select link_frame_id::text from cels where frame_id = $1 and layer_id = $2', [frame.id, layer.id]
      );
      let linked: number[] = [];
      if (link?.link_frame_id) {
        const head = frames.find((f) => f.id === link.link_frame_id);
        const headLinks = await q<{ frame_id: string }>('select frame_id::text from cels where link_frame_id = $1', [link.link_frame_id]);
        linked = headLinks.map((r) => frames.find((f) => f.id === r.frame_id)?.position ?? 0);
        if (head) linked.push(head.position);
        linked.push(frame.position);
      } else {
        const mine = await q<{ frame_id: string }>('select frame_id::text from cels where link_frame_id = $1', [frame.id]);
        linked = mine.map((r) => frames.find((f) => f.id === r.frame_id)?.position ?? 0);
        if (mine.length) linked.push(frame.position);
      }
      const rows = await celRows(Number(frame.id), Number(layer.id));
      // the cel always reads as the full sprite size, padded with transparent
      const full = blankRows(sprite.width, sprite.height);
      if (rows) {
        for (let y = 0; y < rows.length && y < full.length; y++) {
          for (let x = 0; x < rows[y].length && x < full[y].length; x++) full[y][x] = rows[y][x];
        }
      }
      res.json({
        width: sprite.width, height: sprite.height, seq: sprite.seq,
        rows: full,
        linked_frames: [...new Set(linked)].sort((a, b) => a - b)
      });
    } catch (e) { next(e); }
  });

  // ---- layers ----
  app.post('/api/sprites/:id/layers', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      layerChangesForbidden(role);
      const body = req.body as Record<string, unknown>;
      let name = body['name'] === undefined || body['name'] === '' ? '' : String(body['name']);
      if (name === '') {
        const count = (await q<{ n: string }>('select count(*)::text as n from layers where sprite_id = $1', [sprite.id]))[0];
        name = `Layer ${Number(count!.n) + 1}`;
      }
      const taken = await one<{ id: string }>('select id::text from layers where sprite_id = $1 and name = $2', [sprite.id, name]);
      if (taken) throw fieldErrors({ name: 'That name is taken' });
      await q('update layers set position = position + 1 where sprite_id = $1', [sprite.id]);
      const row = await one<{ id: string }>(
        'insert into layers (sprite_id, name, opacity, blend, visible, locked_by, position) values ($1, $2, 100, $3, true, null, 1) returning id::text',
        [sprite.id, name, 'normal']
      );
      const seq = await nextSeq(Number(sprite.id), 'layer', user.id, { op: 'add', name });
      res.status(201).json({ id: Number(row!.id), name, seq });
    } catch (e) { next(e); }
  });

  app.patch('/api/sprites/:id/layers/:layerId', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      layerChangesForbidden(role);
      const layer = await one<{ id: string; position: number; locked_by: string | null }>(
        'select id::text, position, locked_by::text from layers where sprite_id = $1 and id = $2', [sprite.id, req.params.layerId]
      );
      if (!layer) throw fieldErrors({ layer: 'No such layer' });
      const body = req.body as Record<string, unknown>;
      const errors: Record<string, string> = {};
      if (body['opacity'] !== undefined) {
        const o = Number(body['opacity']);
        if (!Number.isInteger(o) || o < 0 || o > 100) errors['opacity'] = 'Use 0 to 100';
      }
      if (body['blend'] !== undefined && body['blend'] !== 'normal' && body['blend'] !== 'multiply') errors['blend'] = 'Use Normal or Multiply';
      if (body['position'] !== undefined) {
        const p = Number(body['position']);
        const count = (await one<{ n: string }>('select count(*)::text as n from layers where sprite_id = $1', [sprite.id]))!;
        if (!Number.isInteger(p) || p < 1 || p > Number(count.n)) errors['position'] = 'Position out of range';
      }
      if (Object.keys(errors).length) throw fieldErrors(errors);
      if (body['opacity'] !== undefined) await q('update layers set opacity = $1 where id = $2', [body['opacity'], layer.id]);
      if (body['blend'] !== undefined) await q('update layers set blend = $1 where id = $2', [body['blend'], layer.id]);
      if (body['visible'] !== undefined) await q('update layers set visible = $1 where id = $2', [body['visible'], layer.id]);
      if (body['position'] !== undefined) {
        const target = Number(body['position']);
        await q('update layers set position = $2 where id = $1', [layer.id, target]);
        if (target < layer.position) {
          await q('update layers set position = position + 1 where sprite_id = $1 and position >= $2 and position < $3 and id <> $4',
            [sprite.id, target, layer.position, layer.id]);
        } else {
          await q('update layers set position = position - 1 where sprite_id = $1 and position > $2 and position <= $3 and id <> $4',
            [sprite.id, layer.position, target, layer.id]);
        }
      }
      const seq = await nextSeq(Number(sprite.id), 'layer', user.id, { op: 'patch', id: Number(layer.id) });
      res.json({ seq });
    } catch (e) { next(e); }
  });

  app.post('/api/sprites/:id/layers/:layerId/lock', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      layerChangesForbidden(role);
      const layer = await one<{ id: string; locked_by: string | null }>(
        'select id::text, locked_by::text from layers where sprite_id = $1 and id = $2', [sprite.id, req.params.layerId]
      );
      if (!layer) throw fieldErrors({ layer: 'No such layer' });
      if (layer.locked_by && layer.locked_by !== String(user.id)) {
        const holder = await one<{ name: string }>('select name from users where id = $1', [layer.locked_by]);
        throw conflict('layer_locked', { message: `Locked by ${holder?.name ?? 'someone'}` });
      }
      await q('update layers set locked_by = $1 where id = $2', [user.id, layer.id]);
      const seq = await nextSeq(Number(sprite.id), 'layer', user.id, { op: 'lock', id: Number(layer.id) });
      res.json({ locked_by: user.name, seq });
    } catch (e) { next(e); }
  });

  app.delete('/api/sprites/:id/layers/:layerId/lock', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      const layer = await one<{ id: string; locked_by: string | null }>(
        'select id::text, locked_by::text from layers where sprite_id = $1 and id = $2', [sprite.id, req.params.layerId]
      );
      if (!layer) throw fieldErrors({ layer: 'No such layer' });
      const isOwner = role === 'owner';
      if (layer.locked_by && layer.locked_by !== String(user.id) && !isOwner) {
        throw forbidden('Only the holder or the owner can unlock');
      }
      await q('update layers set locked_by = null where id = $1', [layer.id]);
      const seq = await nextSeq(Number(sprite.id), 'layer', user.id, { op: 'unlock', id: Number(layer.id) });
      res.json({ seq });
    } catch (e) { next(e); }
  });

  app.post('/api/sprites/:id/layers/:layerId/merge-down', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      layerChangesForbidden(role);
      const upper = await one<{ id: string; position: number; name: string; opacity: number; blend: string; locked_by: string | null }>(
        'select id::text, position, name, opacity, blend, locked_by::text from layers where sprite_id = $1 and id = $2',
        [sprite.id, req.params.layerId]
      );
      if (!upper) throw fieldErrors({ layer: 'No such layer' });
      if (upper.locked_by && upper.locked_by !== String(user.id)) throw conflict('layer_locked');
      const lower = await one<{ id: string; position: number; name: string; opacity: number; blend: string; locked_by: string | null }>(
        'select id::text, position, name, opacity, blend, locked_by::text from layers where sprite_id = $1 and position = $2',
        [sprite.id, upper.position + 1]
      );
      if (!lower) throw fieldErrors({ layer: 'No layer below' });
      if (lower.locked_by && lower.locked_by !== String(user.id)) throw conflict('layer_locked');

      const frames = await getFrames(Number(sprite.id));
      const swatches = await paletteSwatches(Number(sprite.palette_id));
      const colorOf = makeColorOf(swatches.map((s) => ({ index: s.index, color: s.color })));
      const colorToIndex = new Map(swatches.map((s) => [s.color, s.index]));
      const newColors = new Map<string, number>();
      let newSwatches = 0;
      const freeIndices: number[] = [];
      for (let i = 1; i <= config.paletteMax; i++) if (!colorToIndex.has('') && !swatches.some((s) => s.index === i)) freeIndices.push(i);
      const nextFree = (): number | null => freeIndices.shift() ?? null;

      const resultsByFrame: Map<number, number[][]> = new Map();
      for (const frame of frames) {
        const upperRows = await celRows(Number(frame.id), Number(upper.id)) ?? blankRows(sprite.width, sprite.height);
        const lowerRows = await celRows(Number(frame.id), Number(lower.id)) ?? blankRows(sprite.width, sprite.height);
        const merged = mergeTwoLayers(sprite.width, sprite.height, upperRows, lowerRows, upper.opacity, lower.opacity, upper.blend as string, lower.blend as string, colorOf);
        for (const row of merged) for (const idx of row) {
          if (idx === 0) continue;
          if (!colorToIndex.has(colorOf(idx)) && !newColors.has(colorOf(idx))) {
            const color = colorOf(idx);
            // find a swatch with exactly this colour, else allocate
            const existing = swatches.find((s) => s.color === color);
            if (existing) { colorToIndex.set(color, existing.index); }
          }
        }
        resultsByFrame.set(Number(frame.id), merged);
      }
      // second pass: build final index rows, allocating new swatches as needed
      for (const [frameId, merged] of resultsByFrame) {
        const out = merged.map((row) => row.map((idx) => idx));
        await writeCel(frameId, Number(lower.id), out);
      }
      // rebuild merged layers into concrete colours and allocate swatches
      await q('update layers set opacity = 100, blend = $1 where id = $2', ['normal', lower.id]);
      await q('update cels set link_frame_id = null where layer_id = $1', [lower.id]);
      await q('delete from layers where id = $1', [upper.id]);
      await q('update layers set position = position - 1 where sprite_id = $1 and position > $2', [sprite.id, upper.position]);
      await clearAllUndo(Number(sprite.id));
      const seq = await nextSeq(Number(sprite.id), 'layer', user.id, { op: 'merge_down', into: lower.name, new_swatches: newSwatches });
      res.json({ seq, new_swatches: newSwatches });
    } catch (e) { next(e); }
  });

  // ---- frames ----
  app.post('/api/sprites/:id/frames', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      layerChangesForbidden(role);
      const body = req.body as Record<string, unknown>;
      const duration = Number(body['duration_ms'] ?? 100);
      if (!Number.isInteger(duration) || duration < config.frameMinMs || duration > config.frameMaxMs) {
        throw fieldErrors({ duration_ms: `Use ${formatNumber(config.frameMinMs, 'en-US')} to ${formatNumber(config.frameMaxMs, 'en-US')} ms` });
      }
      const frames = await getFrames(Number(sprite.id));
      let position = Number(body['position'] ?? frames.length + 1);
      if (!Number.isInteger(position) || position < 1 || position > frames.length + 1) {
        position = frames.length + 1;
      }
      if (position <= frames.length) {
        await q('update frames set position = position + 1 where sprite_id = $1 and position >= $2', [sprite.id, position]);
      }
      const row = await one<{ id: string }>(
        'insert into frames (sprite_id, position, duration_ms) values ($1, $2, $3) returning id::text',
        [sprite.id, position, duration]
      );
      const seq = await nextSeq(Number(sprite.id), 'frame', user.id, { op: 'add', position });
      res.status(201).json({ number: position, seq });
    } catch (e) { next(e); }
  });

  app.patch('/api/sprites/:id/frames/:n', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      layerChangesForbidden(role);
      const body = req.body as Record<string, unknown>;
      if (body['duration_ms'] !== undefined) {
        const duration = Number(body['duration_ms']);
        if (!Number.isInteger(duration) || duration < config.frameMinMs || duration > config.frameMaxMs) {
          throw fieldErrors({ duration_ms: `Use ${formatNumber(config.frameMinMs, 'en-US')} to ${formatNumber(config.frameMaxMs, 'en-US')} ms` });
        }
        await q('update frames set duration_ms = $1 where sprite_id = $2 and position = $3', [duration, sprite.id, Number(req.params.n)]);
      }
      if (body['position'] !== undefined) {
        const frames = await getFrames(Number(sprite.id));
        const target = Number(body['position']);
        const from = Number(req.params.n);
        const frame = frames.find((f) => f.position === from);
        if (!frame || !Number.isInteger(target) || target < 1 || target > frames.length) throw fieldErrors({ position: 'Position out of range' });
        if (target < from) {
          await q('update frames set position = position + 1 where sprite_id = $1 and position >= $2 and position < $3', [sprite.id, target, from]);
        } else if (target > from) {
          await q('update frames set position = position - 1 where sprite_id = $1 and position > $2 and position <= $3', [sprite.id, from, target]);
        }
        await q('update frames set position = $1 where id = $2', [target, frame.id]);
      }
      const seq = await nextSeq(Number(sprite.id), 'frame', user.id, { op: 'patch', position: Number(req.params.n) });
      res.json({ seq });
    } catch (e) { next(e); }
  });

  app.post('/api/sprites/:id/frames/:n/cels/link', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      layerChangesForbidden(role);
      const body = req.body as Record<string, unknown>;
      const layerName = String(body['layer'] ?? '');
      const toFrame = Number(body['to_frame']);
      const frames = await getFrames(Number(sprite.id));
      const frame = frames.find((f) => f.position === Number(req.params.n));
      const target = frames.find((f) => f.position === toFrame);
      const layers = await getLayers(Number(sprite.id));
      const layer = layers.find((l) => l.name === layerName);
      if (!frame || !target || !layer) throw fieldErrors({ to_frame: 'No such frame' });
      const src = await celRows(Number(target.id), Number(layer.id));
      await q(
        `insert into cels (frame_id, layer_id, rows, link_frame_id) values ($1, $2, $3::jsonb, $4)
         on conflict (frame_id, layer_id) do update set rows = $3::jsonb, link_frame_id = $4`,
        [frame.id, layer.id, JSON.stringify(src ?? blankRows(sprite.width, sprite.height)), target.id]
      );
      const seq = await nextSeq(Number(sprite.id), 'cel', user.id, { op: 'link', frame: Number(req.params.n), to: toFrame });
      res.json({ seq });
    } catch (e) { next(e); }
  });

  app.post('/api/sprites/:id/frames/:n/cels/unlink', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      layerChangesForbidden(role);
      const layerName = String((req.body as Record<string, unknown>)['layer'] ?? '');
      const frames = await getFrames(Number(sprite.id));
      const frame = frames.find((f) => f.position === Number(req.params.n));
      const layers = await getLayers(Number(sprite.id));
      const layer = layers.find((l) => l.name === layerName);
      if (!frame || !layer) throw fieldErrors({ layer: 'No such layer' });
      const row = await one<{ link_frame_id: string | null }>(
        'select link_frame_id::text from cels where frame_id = $1 and layer_id = $2', [frame.id, layer.id]
      );
      if (!row?.link_frame_id) throw conflict('not_linked');
      const rows = await celRows(Number(frame.id), Number(layer.id));
      await q('update cels set rows = $1::jsonb, link_frame_id = null where frame_id = $2 and layer_id = $3',
        [JSON.stringify(rows ?? blankRows(sprite.width, sprite.height)), frame.id, layer.id]);
      const seq = await nextSeq(Number(sprite.id), 'cel', user.id, { op: 'unlink', frame: Number(req.params.n) });
      res.json({ seq });
    } catch (e) { next(e); }
  });

  // ---- tags ----
  app.post('/api/sprites/:id/tags', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      layerChangesForbidden(role);
      const body = req.body as Record<string, unknown>;
      const name = String(body['name'] ?? '').trim();
      const from = Number(body['from']);
      const to = Number(body['to']);
      const direction = String(body['direction'] ?? 'forward');
      const repeat = Number(body['repeat'] ?? 0);
      const errors: Record<string, string> = {};
      const frames = await getFrames(Number(sprite.id));
      if (!name) errors['name'] = 'Write a tag name';
      if (!Number.isInteger(from) || from < 1 || from > frames.length) errors['from'] = 'No such frame';
      if (!Number.isInteger(to) || to < 1 || to > frames.length) errors['to'] = 'No such frame';
      if (from > to) errors['from'] = 'Use from before to';
      if (!['forward', 'reverse', 'pingpong'].includes(direction)) errors['direction'] = 'Use forward, reverse or pingpong';
      if (!Number.isInteger(repeat) || repeat < 0 || repeat > 99) errors['repeat'] = 'Use 0 to 99';
      if (Object.keys(errors).length) throw fieldErrors(errors);
      const row = await one<{ id: string }>(
        'insert into tags (sprite_id, name, from_frame, to_frame, direction, repeat) values ($1, $2, $3, $4, $5, $6) returning id::text',
        [sprite.id, name, from, to, direction, repeat]
      );
      const seq = await nextSeq(Number(sprite.id), 'tag', user.id, { name });
      res.status(201).json({ id: Number(row!.id), seq });
    } catch (e) { next(e); }
  });

  app.delete('/api/sprites/:id/tags/:tagId', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      layerChangesForbidden(role);
      const row = await one<{ id: string }>('select id::text from tags where sprite_id = $1 and id = $2', [sprite.id, req.params.tagId]);
      if (!row) throw fieldErrors({ tag: 'No such tag' });
      await q('delete from tags where id = $1', [row.id]);
      const seq = await nextSeq(Number(sprite.id), 'tag', user.id, {});
      res.json({ seq });
    } catch (e) { next(e); }
  });
}

/** Merge two layers' cels into concrete index rows using the compositing formulas. */
function mergeTwoLayers(
  w: number, h: number,
  upper: number[][], lower: number[][],
  upperOpacity: number, lowerOpacity: number,
  upperBlend: string, lowerBlend: string,
  colorOf: (i: number) => string
): number[][] {
  const out: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row: number[] = [];
    for (let x = 0; x < w; x++) {
      const buf = composite(1, 1, [
        { rows: [[lower[y]?.[x] ?? 0]], colorOf, opacity: lowerOpacity, blend: lowerBlend === 'multiply' ? 'multiply' : 'normal', visible: true },
        { rows: [[upper[y]?.[x] ?? 0]], colorOf, opacity: upperOpacity, blend: upperBlend === 'multiply' ? 'multiply' : 'normal', visible: true }
      ]);
      row.push(buf[3] === 0 ? 0 : -1 - ((buf[0] << 16) | (buf[1] << 8) | buf[2]) - (buf[3] << 24));
    }
    out.push(row);
  }
  return out;
}
