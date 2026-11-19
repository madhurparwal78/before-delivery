import type { Express } from 'express';
import { q, one } from './db.js';
import { notFound, forbidden, conflict, fieldErrors } from './errors.js';
import { now } from './clock.js';
import { requireUser } from './http.js';
import { config } from './http.js';
import {
  getSprite, getLayers, getFrames, celRows, writeCel, blankRows, nextSeq, pushUndo,
  type LayerRow, type SpriteRow
} from './sprites.js';
import { requireMember, recordActivity } from './projects.js';
import { swatchCounts, paletteSwatches } from './render.js';
import {
  applyStrokeToCel, formatNumber, linePoints, type Cel
} from '../shared/rules.js';

interface StrokeBody {
  client_stroke_id: string;
  frame: number;
  layer: string;
  tool: string;
  points: [number, number][];
  swatch: number;
  size: number;
  mirror: string;
  options: Record<string, unknown>;
}

async function frameByPosition(spriteId: number, position: number) {
  return one<{ id: string; position: number; duration_ms: number }>(
    'select id::text, position, duration_ms from frames where sprite_id = $1 and position = $2',
    [spriteId, position]
  );
}

async function layerById(spriteId: number, id: number) {
  return one<{ id: string; name: string; locked_by: string | null; position: number; opacity: number; blend: string; visible: boolean }>(
    'select id::text, name, locked_by::text, position, opacity, blend, visible from layers where sprite_id = $1 and id = $2',
    [spriteId, id]
  );
}

function validateStroke(body: StrokeBody, sprite: SpriteRow): void {
  const tools = ['pencil', 'eraser', 'line', 'rectangle', 'ellipse', 'fill', 'dither'];
  if (!tools.includes(body.tool)) throw fieldErrors({ tool: 'Unknown tool' });
  if (!Array.isArray(body.points) || body.points.length === 0) throw fieldErrors({ points: 'Give at least one point' });
  for (const p of body.points) {
    if (!Array.isArray(p) || p.length !== 2 || !Number.isInteger(p[0]) || !Number.isInteger(p[1])) {
      throw fieldErrors({ points: 'Give whole pixel coordinates' });
    }
  }
  if (!Number.isInteger(body.size) || body.size < 1 || body.size > 8) throw fieldErrors({ size: 'Use 1 to 8' });
  if (!['none', 'x', 'y', 'both'].includes(body.mirror)) throw fieldErrors({ tool: 'Unknown mirror' });
}

/** The one place that applies a stroke and records undo. */
async function applyStroke(sprite: SpriteRow, layer: LayerRow, frameId: number, body: StrokeBody, userId: number, userName: string) {
  const rows = await celRows(frameId, Number(layer.id));
  const before = rows ? rows.map((r) => [...r]) : blankRows(sprite.width, sprite.height);
  const cel: Cel = { rows: before.map((r) => [...r]) };
  const opts = (body.options ?? {}) as Record<string, unknown>;
  const result = applyStrokeToCel(cel, {
    tool: body.tool as never,
    points: body.points,
    swatch: body.swatch,
    size: body.size,
    mirror: body.mirror as never,
    options: {
      filled: opts['filled'] === true,
      contiguous: opts['contiguous'] !== false,
      secondary: typeof opts['secondary'] === 'number' ? opts['secondary'] : 0,
      level: typeof opts['level'] === 'number' ? opts['level'] : 8,
      pixelPerfect: opts['pixel_perfect'] === true
    }
  });
  await writeCel(frameId, Number(layer.id), cel.rows);
  const seq = await nextSeq(Number(sprite.id), 'stroke', userId, {
    frame: body.frame, layer: layer.name, tool: body.tool, changed: result.changed
  });
  // a stroke is one undoable action, personal to this person
  await pushUndo(userId, Number(sprite.id), {
    kind: 'stroke',
    frame: body.frame,
    layer: String(layer.id),
    before,
    after: cel.rows.map((r) => [...r])
  }, config.undoDepth);
  return { seq, changed: result.changed };
}

export function registerDrawingRoutes(app: Express): void {
  app.post('/api/sprites/:id/strokes', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      if (role === 'reviewer') throw forbidden("Reviewers can't draw");
      const body = req.body as StrokeBody;
      if (!body.client_stroke_id) throw fieldErrors({ client_stroke_id: 'Missing stroke id' });

      // idempotent replay first, before any state check
      const replay = await one<{ response: unknown }>(
        'select response from stroke_dedup where sprite_id = $1 and client_stroke_id = $2 and user_id = $3',
        [sprite.id, body.client_stroke_id, user.id]
      );
      if (replay) { res.status(201).json(replay.response); return; }

      validateStroke(body, sprite);
      const frame = await frameByPosition(Number(sprite.id), body.frame);
      if (!frame) throw fieldErrors({ frame: 'No such frame' });
      const layer = await layerById(Number(sprite.id), Number(body.layer));
      if (!layer) throw fieldErrors({ layer: 'No such layer' });
      if (layer.locked_by && layer.locked_by !== String(user.id)) {
        const holder = await one<{ name: string }>('select name from users where id = $1', [layer.locked_by]);
        throw conflict('layer_locked', { message: `Locked by ${holder?.name ?? 'someone'}` });
      }
      const swatch = await one<{ index: number }>(
        'select index from swatches where palette_id = $1 and index = $2', [sprite.palette_id, body.swatch]
      );
      if (!swatch) throw fieldErrors({ swatch: `Swatch ${body.swatch} was removed` });

      const { seq, changed } = await applyStroke(sprite, layer as unknown as LayerRow, Number(frame.id), body, user.id, user.name);
      const response = { seq, pixels_changed: changed };
      await q('insert into stroke_dedup (sprite_id, client_stroke_id, user_id, response) values ($1, $2, $3, $4::jsonb) on conflict do nothing',
        [sprite.id, body.client_stroke_id, user.id, JSON.stringify(response)]);
      await recordActivity(Number(sprite.project_id), Number(sprite.id), 'stroke', user.id,
        `${user.name} painted ${formatNumber(changed, 'en-US')} pixels`, body.client_stroke_id);
      res.status(201).json(response);
    } catch (e) { next(e); }
  });

  app.post('/api/sprites/:id/selection', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      const role = await requireMember(Number(sprite.project_id), user.id);
      if (role === 'reviewer') throw forbidden("Reviewers can't draw");
      const body = req.body as Record<string, unknown>;
      const clientStrokeId = String(body['client_stroke_id'] ?? '');
      const replay = await one<{ response: unknown }>(
        'select response from stroke_dedup where sprite_id = $1 and client_stroke_id = $2 and user_id = $3',
        [sprite.id, clientStrokeId, user.id]
      );
      if (replay) { res.status(201).json(replay.response); return; }
      const op = String(body['op'] ?? '');
      if (!['move', 'paste', 'flip_h', 'flip_v', 'rotate'].includes(op)) throw fieldErrors({ op: 'Unknown operation' });
      const framePos = Number(body['frame']);
      const frame = await frameByPosition(Number(sprite.id), framePos);
      if (!frame) throw fieldErrors({ frame: 'No such frame' });
      const layer = await layerById(Number(sprite.id), Number(body['layer']));
      if (!layer) throw fieldErrors({ layer: 'No such layer' });
      if (layer.locked_by && layer.locked_by !== String(user.id)) {
        const holder = await one<{ name: string }>('select name from users where id = $1', [layer.locked_by]);
        throw conflict('layer_locked', { message: `Locked by ${holder?.name ?? 'someone'}` });
      }
      const rect = body['rect'] as { x: number; y: number; w: number; h: number };
      const rows = await celRows(Number(frame.id), Number(layer.id));
      const before = rows ? rows.map((r) => [...r]) : blankRows(sprite.width, sprite.height);
      const after = before.map((r) => [...r]);
      let changed = 0;
      const setCell = (x: number, y: number, idx: number): void => {
        if (y < 0 || y >= after.length || x < 0 || x >= after[0].length) return;
        if (after[y][x] !== idx) changed++;
        after[y][x] = idx;
      };
      const inRect = (x: number, y: number): boolean => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      if (op === 'move' || op === 'paste') {
        const to = body['to'] as { x: number; y: number };
        let src: number[][];
        if (op === 'move') {
          src = [];
          for (let y = 0; y < rect.h; y++) {
            src.push([]);
            for (let x = 0; x < rect.w; x++) src[y].push(before[rect.y + y]?.[rect.x + x] ?? 0);
          }
          for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) setCell(rect.x + x, rect.y + y, 0);
        } else {
          src = (body['rows'] as number[][]);
        }
        for (let y = 0; y < src.length; y++) for (let x = 0; x < src[y].length; x++) {
          if (src[y][x] === 0) continue;
          setCell(to.x + x, to.y + y, src[y][x]);
        }
      } else if (op === 'flip_h') {
        const snapshot = before.map((r) => [...r]);
        for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
          const v = snapshot[rect.y + y]?.[rect.x + (rect.w - 1 - x)] ?? 0;
          if (inRect(rect.x + x, rect.y + y)) setCell(rect.x + x, rect.y + y, v);
        }
      } else if (op === 'flip_v') {
        const snapshot = before.map((r) => [...r]);
        for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
          const v = snapshot[rect.y + (rect.h - 1 - y)]?.[rect.x + x] ?? 0;
          if (inRect(rect.x + x, rect.y + y)) setCell(rect.x + x, rect.y + y, v);
        }
      } else if (op === 'rotate') {
        const snapshot = before.map((r) => [...r]);
        // clear old rect
        for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) setCell(rect.x + x, rect.y + y, 0);
        // (x,y) -> (left + H-1-(y-top), top + (x-left))
        const w = rect.h, h = rect.w;
        for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
          const v = snapshot[rect.y + y]?.[rect.x + x] ?? 0;
          setCell(rect.x + (rect.h - 1 - y), rect.y + x, v);
        }
      }
      await writeCel(Number(frame.id), Number(layer.id), after);
      const seq = await nextSeq(Number(sprite.id), 'selection', user.id, { frame: framePos, op });
      const response = { seq, pixels_changed: changed };
      await q('insert into stroke_dedup (sprite_id, client_stroke_id, user_id, response) values ($1, $2, $3, $4::jsonb) on conflict do nothing',
        [sprite.id, clientStrokeId, user.id, JSON.stringify(response)]);
      await recordActivity(Number(sprite.project_id), Number(sprite.id), 'stroke', user.id,
        `${user.name} painted ${formatNumber(changed, 'en-US')} pixels`, clientStrokeId);
      res.status(201).json(response);
    } catch (e) { next(e); }
  });

  app.get('/api/sprites/:id/events', async (req, res, next) => {
    try {
      const user = await requireUser(req);
      const sprite = await getSprite(req.params.id);
      await requireMember(Number(sprite.project_id), user.id);
      const since = Number(req.query.since ?? 0);
      const rows = await q<{ seq: number; type: string; by_name: string | null; at: string; data: Record<string, unknown> }>(
        `select e.seq, e.type, u.name as by_name, e.at, e.data from sprite_events e
         left join users u on u.id = e.by where e.sprite_id = $1 and e.seq > $2 order by e.seq asc`,
        [sprite.id, Number.isFinite(since) ? since : 0]
      );
      res.json({ events: rows.map((r) => ({ seq: r.seq, type: r.type, by: r.by_name, at: r.at, data: r.data })) });
    } catch (e) { next(e); }
  });
}
