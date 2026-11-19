import { strokeWrites, type StrokeShape } from '../../shared/draw.js';
import { selectionWrites } from '../../shared/selection.js';
import type { MirrorMode, Point, SelectionOp, StrokeTool } from '../../shared/types.js';
import { openSprite, requireDrawing } from '../access.js';
import { recordActivity } from '../activity.js';
import { conflict, unprocessable } from '../errors.js';
import type { Ctx, Route } from '../http.js';
import {
  applyCelPatch,
  applyCelWrites,
  conflictingPerson,
  recordOperation,
  replayedResponse,
  spriteTransaction,
  stackTop,
  type CelPatch,
  type OpContext,
  type Patch,
} from '../ops.js';
import { noteActivity } from '../presence.js';
import { ensureBuffer, swatchUsage, type SwatchRow } from '../sprite.js';
import { swatchesOf } from '../sprite.js';
import { idParam } from '../validate.js';
import { frameByNumber, layerByName } from './sprites.js';
import type { PoolClient } from 'pg';
import { first, rows } from '../db.js';

const TOOLS: StrokeTool[] = ['pencil', 'eraser', 'line', 'rectangle', 'ellipse', 'fill', 'dither'];
const MIRRORS: MirrorMode[] = ['none', 'x', 'y', 'both'];
const SELECTION_OPS: SelectionOp[] = ['move', 'paste', 'flip_h', 'flip_v', 'rotate'];

function readPoints(value: unknown, field = 'points'): Point[] {
  if (!Array.isArray(value) || value.length === 0) throw unprocessable({ [field]: 'Send at least one cell' });
  return value.map((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) throw unprocessable({ [field]: 'Send cells as pairs' });
    const x = Number(entry[0]);
    const y = Number(entry[1]);
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw unprocessable({ [field]: 'Send whole-number cells' });
    }
    return { x, y };
  });
}

async function requireUnlocked(
  client: PoolClient,
  layer: { id: number; locked_by: number | null },
  personId: number,
): Promise<void> {
  if (layer.locked_by === null || layer.locked_by === personId) return;
  const holder = await first<{ name: string }>(client, 'SELECT name FROM users WHERE id = $1', [
    layer.locked_by,
  ]);
  throw conflict({ error: 'layer_locked', message: `Locked by ${(holder as { name: string }).name}` });
}

async function framesSharing(client: PoolClient, bufferId: number): Promise<number[]> {
  const list = await rows<{ number: number }>(
    client,
    `SELECT f.number FROM cels c JOIN frames f ON f.id = c.frame_id WHERE c.buffer_id = $1 ORDER BY f.number`,
    [bufferId],
  );
  return list.map((row) => row.number);
}

async function noteStroke(
  opCtx: OpContext,
  frameNumber: number,
  pixels: number,
): Promise<void> {
  await recordActivity(opCtx.client, {
    projectId: opCtx.sprite.project_id,
    kind: 'stroke',
    userId: opCtx.person.id,
    userName: opCtx.person.name,
    spriteId: opCtx.sprite.id,
    spriteName: opCtx.sprite.name,
    pixels,
    frame: frameNumber,
    at: opCtx.at,
  });
  opCtx.events.push({ type: 'activity' });
}

export const drawingRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/sprites/:id/strokes',
    handler: async (ctx) => {
      const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
      requireDrawing(access);
      const clientStrokeId = String(ctx.body.client_stroke_id ?? '');
      if (clientStrokeId === '') throw unprocessable({ client_stroke_id: 'Send a stroke id' });
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const stored = await replayedResponse(opCtx.client, sprite.id, access.person.id, clientStrokeId);
        if (stored !== null) return { status: 201, body: stored };

        const tool = String(ctx.body.tool ?? '') as StrokeTool;
        if (!TOOLS.includes(tool)) throw unprocessable({ tool: 'Choose a drawing tool' });
        const size = Number(ctx.body.size ?? 1);
        if (!Number.isInteger(size) || size < 1 || size > 8) {
          throw unprocessable({ size: 'Use 1 to 8' });
        }
        const mirror = (MIRRORS.includes(String(ctx.body.mirror ?? 'none') as MirrorMode)
          ? String(ctx.body.mirror ?? 'none')
          : 'none') as MirrorMode;
        const points = readPoints(ctx.body.points);
        const frame = await frameByNumber(opCtx.client, sprite.id, Number(ctx.body.frame));
        const layer = await layerByName(opCtx.client, sprite.id, String(ctx.body.layer ?? ''));
        await requireUnlocked(opCtx.client, layer, access.person.id);

        const swatch = Number(ctx.body.swatch ?? 0);
        const palette = await swatchesOf(opCtx.client, sprite.palette_id);
        const livingSwatch = (index: number): SwatchRow | undefined =>
          palette.find((entry) => entry.index === index && entry.present);
        if (tool !== 'eraser' && (swatch !== 0 && livingSwatch(swatch) === undefined)) {
          throw unprocessable({ swatch: `Swatch ${swatch} was removed` });
        }
        const options = (ctx.body.options ?? {}) as Record<string, unknown>;
        if (tool === 'dither') {
          const secondary = Number(options.secondary ?? 0);
          if (secondary !== 0 && livingSwatch(secondary) === undefined) {
            throw unprocessable({ swatch: `Swatch ${secondary} was removed` });
          }
        }

        const { bufferId, surface } = await ensureBuffer(opCtx.client, sprite, frame.id, layer.id);
        const shape: StrokeShape = {
          tool,
          points,
          swatch,
          size,
          mirror,
          options: {
            filled: options.filled === true,
            contiguous: options.contiguous !== false,
            secondary: Number(options.secondary ?? 0),
            level: Number(options.level ?? 8),
            pixel_perfect: options.pixel_perfect === true,
          },
        };
        const writes = strokeWrites(shape, surface);
        const { patch, changed } = await applyCelWrites(opCtx, { bufferId, surface, writes });
        const response = { seq: 0, pixels_changed: changed };
        const seq = await recordOperation(opCtx, {
          type: 'stroke',
          data: {
            frame: frame.number,
            layer: layer.name,
            tool,
            pixels_changed: changed,
          },
          patch: { cels: [patch] },
          undoable: true,
          clientStrokeId,
          response: { seq: 0, pixels_changed: changed },
        });
        response.seq = seq;
        await opCtx.client.query('UPDATE operations SET response = $2 WHERE sprite_id = $1 AND seq = $3', [
          sprite.id,
          JSON.stringify(response),
          seq,
        ]);
        await noteStroke(opCtx, frame.number, changed);
        noteActivity(sprite.id, access.person.id, opCtx.at.getTime());
        opCtx.events.push({
          type: 'op',
          seq,
          op: 'stroke',
          by: access.person.name,
          data: {
            frame: frame.number,
            layer: layer.name,
            frames: await framesSharing(opCtx.client, bufferId),
            pixels_changed: changed,
            cells: patch.offsets.map((offset, at) => [
              offset % sprite.width,
              Math.floor(offset / sprite.width),
              patch.after[at],
            ]),
          },
        });
        return { status: 201, body: response };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/sprites/:id/selection',
    handler: async (ctx) => {
      const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
      requireDrawing(access);
      const clientStrokeId = String(ctx.body.client_stroke_id ?? '');
      if (clientStrokeId === '') throw unprocessable({ client_stroke_id: 'Send a stroke id' });
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const stored = await replayedResponse(opCtx.client, sprite.id, access.person.id, clientStrokeId);
        if (stored !== null) return { status: 201, body: stored };

        const op = String(ctx.body.op ?? '') as SelectionOp;
        if (!SELECTION_OPS.includes(op)) throw unprocessable({ op: 'Choose a selection operation' });
        const rect = (ctx.body.rect ?? {}) as Record<string, unknown>;
        const numbers = ['x', 'y', 'w', 'h'].map((key) => Number(rect[key]));
        if (numbers.some((value) => !Number.isInteger(value))) {
          throw unprocessable({ rect: 'Send a whole-number rectangle' });
        }
        const [x, y, w, h] = numbers;
        if (w < 1 || h < 1) throw unprocessable({ rect: 'Select at least one cell' });
        const to = ctx.body.to === undefined ? undefined : (ctx.body.to as Record<string, unknown>);
        const destination =
          to === undefined
            ? undefined
            : { x: Number(to.x), y: Number(to.y) };
        if (destination !== undefined && (!Number.isInteger(destination.x) || !Number.isInteger(destination.y))) {
          throw unprocessable({ to: 'Send a whole-number cell' });
        }
        const pasteRows = Array.isArray(ctx.body.rows) ? (ctx.body.rows as number[][]) : undefined;
        if (op === 'paste' && (pasteRows === undefined || destination === undefined)) {
          throw unprocessable({ rows: 'Send the cells to paste' });
        }
        const frame = await frameByNumber(opCtx.client, sprite.id, Number(ctx.body.frame));
        const layer = await layerByName(opCtx.client, sprite.id, String(ctx.body.layer ?? ''));
        await requireUnlocked(opCtx.client, layer, access.person.id);
        const { bufferId, surface } = await ensureBuffer(opCtx.client, sprite, frame.id, layer.id);
        const result = selectionWrites(
          { op, rect: { x, y, w, h }, to: destination, rows: pasteRows },
          surface,
        );
        const { patch, changed } = await applyCelWrites(opCtx, { bufferId, surface, writes: result.writes });
        const response = { seq: 0, pixels_changed: changed };
        const seq = await recordOperation(opCtx, {
          type: 'selection',
          data: { frame: frame.number, layer: layer.name, op, pixels_changed: changed },
          patch: { cels: [patch] },
          undoable: true,
          clientStrokeId,
          response,
        });
        response.seq = seq;
        await opCtx.client.query('UPDATE operations SET response = $2 WHERE sprite_id = $1 AND seq = $3', [
          sprite.id,
          JSON.stringify(response),
          seq,
        ]);
        await noteStroke(opCtx, frame.number, changed);
        opCtx.events.push({
          type: 'op',
          seq,
          op: 'selection',
          by: access.person.name,
          data: {
            frame: frame.number,
            layer: layer.name,
            frames: await framesSharing(opCtx.client, bufferId),
            pixels_changed: changed,
            rect: result.rect,
          },
        });
        return { status: 201, body: response };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/sprites/:id/undo',
    handler: async (ctx) => undoOrRedo(ctx, 'undo'),
  },
  {
    method: 'POST',
    pattern: '/api/sprites/:id/redo',
    handler: async (ctx) => undoOrRedo(ctx, 'redo'),
  },
];

async function reverseSwatch(
  opCtx: OpContext,
  patch: Patch,
  direction: 'before' | 'after',
): Promise<void> {
  const swatch = patch.swatch;
  if (swatch === undefined) return;
  const state = direction === 'before' ? swatch.before : swatch.after;
  if (state === null) {
    await opCtx.client.query('UPDATE swatches SET present = false WHERE palette_id = $1 AND index = $2', [
      swatch.palette,
      swatch.index,
    ]);
    return;
  }
  await opCtx.client.query(
    `UPDATE swatches SET color = $3, version = version + 1, present = $4, edited_by = $5
      WHERE palette_id = $1 AND index = $2`,
    [swatch.palette, swatch.index, state.color, state.present, opCtx.person.id],
  );
}

async function reverseMap(opCtx: OpContext, patch: Patch, direction: 'before' | 'after'): Promise<void> {
  const map = patch.map;
  if (map === undefined) return;
  for (const cell of map.cells) {
    const state = direction === 'before' ? cell.before : cell.after;
    if (state === null || state.tile === 0) {
      await opCtx.client.query('DELETE FROM tilemap_cells WHERE tilemap_id = $1 AND x = $2 AND y = $3', [
        map.tilemap,
        cell.x,
        cell.y,
      ]);
      continue;
    }
    await opCtx.client.query(
      `INSERT INTO tilemap_cells (tilemap_id, x, y, tile, flip_h, flip_v) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tilemap_id, x, y) DO UPDATE SET tile = $4, flip_h = $5, flip_v = $6`,
      [map.tilemap, cell.x, cell.y, state.tile, state.flip_h, state.flip_v],
    );
  }
}

async function undoOrRedo(ctx: Ctx, which: 'undo' | 'redo'): Promise<{ status: number; body: unknown }> {
  const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
  requireDrawing(access);
  return spriteTransaction(sprite.id, access.person, async (opCtx) => {
    const target = await stackTop(opCtx, which === 'undo' ? 'active' : 'undone');
    if (target === null) {
      throw conflict(
        which === 'undo'
          ? { error: 'nothing_to_undo', message: 'Nothing to undo' }
          : { error: 'nothing_to_redo', message: 'Nothing to redo' },
      );
    }
    const blocker = await conflictingPerson(opCtx, target);
    if (blocker !== null) {
      throw conflict({
        error: which === 'undo' ? 'undo_conflict' : 'redo_conflict',
        message: `Can't ${which}: ${blocker} changed this`,
      });
    }
    const direction = which === 'undo' ? 'before' : 'after';
    let changed = 0;
    const cels: CelPatch[] = target.patch.cels ?? [];
    for (const cel of cels) changed += await applyCelPatch(opCtx.client, sprite, cel, direction);
    await reverseSwatch(opCtx, target.patch, direction);
    await reverseMap(opCtx, target.patch, direction);
    await opCtx.client.query('UPDATE operations SET stack_state = $2 WHERE id = $1', [
      target.id,
      which === 'undo' ? 'undone' : 'active',
    ]);
    const usage = await swatchUsage(opCtx.client, sprite);
    const swatchIndex = target.patch.swatch?.index ?? null;
    const seq = await recordOperation(opCtx, {
      type: which,
      data: { of: target.type, seq: target.seq },
      patch: target.patch,
    });
    opCtx.events.push({
      type: 'op',
      seq,
      op: which,
      by: access.person.name,
      data: {
        of: target.type,
        swatch:
          swatchIndex === null
            ? null
            : {
                index: swatchIndex,
                color: (direction === 'before' ? target.patch.swatch?.before : target.patch.swatch?.after)?.color ?? null,
                used_by: usage.get(swatchIndex)?.pixels ?? 0,
                frames: usage.get(swatchIndex)?.frames ?? 0,
                cursor: null,
              },
      },
    });
    return { status: 200, body: { seq, pixels_changed: changed } };
  });
}
