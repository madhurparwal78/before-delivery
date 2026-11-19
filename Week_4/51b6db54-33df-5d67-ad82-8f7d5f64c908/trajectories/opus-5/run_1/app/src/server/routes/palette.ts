import { openPalette, requireArtwork } from '../access.js';
import { recordActivity } from '../activity.js';
import { conflict, unprocessable } from '../errors.js';
import type { Route } from '../http.js';
import {
  addSwatch,
  paletteLimitText,
  paletteOrder,
  parsePaletteFile,
  rampColours,
  requireColourText,
  swatchBodies,
  TRANSPARENT_INDEX_TEXT,
} from '../palette.js';
import { recordOperation, spriteTransaction } from '../ops.js';
import { cursorOf } from '../presence.js';
import { swatchesOf, swatchUsage } from '../sprite.js';
import { idParam, wholeNumber } from '../validate.js';
import { config } from '../config.js';

export const paletteRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/palettes/:id',
    handler: async (ctx) => {
      const paletteId = idParam(ctx, 'id');
      const { sprite, access } = await openPalette(ctx, paletteId);
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const usage = await swatchUsage(opCtx.client, sprite);
        return {
          status: 200,
          body: {
            id: paletteId,
            order: await paletteOrder(opCtx.client, paletteId),
            swatches: await swatchBodies(opCtx.client, paletteId, usage),
          },
        };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/palettes/:id/swatches',
    handler: async (ctx) => {
      const paletteId = idParam(ctx, 'id');
      const { sprite, access } = await openPalette(ctx, paletteId);
      requireArtwork(access);
      const colour = requireColourText(ctx.body.color);
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const made = await addSwatch(opCtx.client, paletteId, colour, access.person.id);
        const seq = await recordOperation(opCtx, {
          type: 'palette',
          data: { action: 'add', index: made.index, color: colour },
        });
        opCtx.events.push({ type: 'op', seq, op: 'palette', by: access.person.name });
        return { status: 201, body: { ...made, seq } };
      });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/palettes/:id/swatches/:index',
    handler: async (ctx) => {
      const paletteId = idParam(ctx, 'id');
      const { sprite, access } = await openPalette(ctx, paletteId);
      requireArtwork(access);
      const index = idParam(ctx, 'index');
      if (index === 0) throw unprocessable({ index: TRANSPARENT_INDEX_TEXT });
      const colour = requireColourText(ctx.body.color);
      const version = Number(ctx.body.version);
      if (!Number.isInteger(version)) throw unprocessable({ version: 'Send the version you read' });
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const swatches = await swatchesOf(opCtx.client, paletteId);
        const swatch = swatches.find((entry) => entry.index === index);
        if (swatch === undefined) throw unprocessable({ index: 'That swatch is gone' });
        if (!swatch.present) {
          throw conflict({
            error: 'swatch_removed',
            message: `${swatch.removed_by_name ?? 'Someone'} removed this swatch first`,
          });
        }
        if (swatch.version !== version) {
          throw conflict({
            error: 'version_conflict',
            current: { index, color: swatch.color, version: swatch.version },
          });
        }
        const nextVersion = swatch.version + 1;
        await opCtx.client.query(
          'UPDATE swatches SET color = $3, version = $4, edited_by = $5 WHERE palette_id = $1 AND index = $2',
          [paletteId, index, colour, nextVersion, access.person.id],
        );
        const usage = await swatchUsage(opCtx.client, sprite);
        const counts = usage.get(index) ?? { pixels: 0, frames: 0 };
        const seq = await recordOperation(opCtx, {
          type: 'swatch',
          data: { index, color: colour, version: nextVersion },
          patch: {
            swatch: {
              palette: paletteId,
              index,
              before: { color: swatch.color, version: swatch.version, present: true },
              after: { color: colour, version: nextVersion, present: true },
            },
          },
          undoable: true,
        });
        await recordActivity(opCtx.client, {
          projectId: sprite.project_id,
          kind: 'swatch',
          userId: access.person.id,
          userName: access.person.name,
          spriteId: sprite.id,
          spriteName: sprite.name,
          detail: String(index),
          at: opCtx.at,
        });
        opCtx.events.push({ type: 'activity' });
        opCtx.events.push({
          type: 'op',
          seq,
          op: 'swatch',
          by: access.person.name,
          data: {
            index,
            color: colour,
            version: nextVersion,
            used_by: counts.pixels,
            frames: counts.frames,
            cursor: cursorOf(sprite.id, access.person.id),
          },
        });
        return {
          status: 200,
          body: {
            index,
            color: colour,
            version: nextVersion,
            used_by: counts.pixels,
            frames: counts.frames,
            seq,
          },
        };
      });
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/palettes/:id/swatches/:index',
    handler: async (ctx) => {
      const paletteId = idParam(ctx, 'id');
      const { sprite, access } = await openPalette(ctx, paletteId);
      requireArtwork(access);
      const index = idParam(ctx, 'index');
      if (index === 0) throw unprocessable({ index: TRANSPARENT_INDEX_TEXT });
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const swatches = await swatchesOf(opCtx.client, paletteId);
        const swatch = swatches.find((entry) => entry.index === index && entry.present);
        if (swatch === undefined) throw unprocessable({ index: 'That swatch is gone' });
        const usage = await swatchUsage(opCtx.client, sprite);
        const count = usage.get(index)?.pixels ?? 0;
        if (count > 0) {
          throw conflict({
            error: 'swatch_in_use',
            message: `Used by ${ctx.num(count)} ${count === 1 ? 'pixel' : 'pixels'}`,
          });
        }
        await opCtx.client.query(
          'UPDATE swatches SET present = false, removed_by = $3 WHERE palette_id = $1 AND index = $2',
          [paletteId, index, access.person.id],
        );
        const seq = await recordOperation(opCtx, {
          type: 'palette',
          data: { action: 'remove', index },
        });
        opCtx.events.push({ type: 'op', seq, op: 'palette', by: access.person.name });
        return { status: 200, body: { seq } };
      });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/palettes/:id/order',
    handler: async (ctx) => {
      const paletteId = idParam(ctx, 'id');
      const { sprite, access } = await openPalette(ctx, paletteId);
      requireArtwork(access);
      const wanted = Array.isArray(ctx.body.order) ? (ctx.body.order as unknown[]).map(Number) : null;
      if (wanted === null || wanted.some((index) => !Number.isInteger(index))) {
        throw unprocessable({ order: 'Send the swatch indices in order' });
      }
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const present = (await swatchesOf(opCtx.client, paletteId))
          .filter((swatch) => swatch.present)
          .map((swatch) => swatch.index);
        const sameSet =
          wanted.length === present.length && present.every((index) => wanted.includes(index));
        if (!sameSet) throw unprocessable({ order: 'Send every swatch exactly once' });
        await opCtx.client.query('UPDATE palettes SET swatch_order = $2 WHERE id = $1', [
          paletteId,
          wanted,
        ]);
        const seq = await recordOperation(opCtx, { type: 'palette', data: { action: 'order' } });
        opCtx.events.push({ type: 'op', seq, op: 'palette', by: access.person.name });
        return { status: 200, body: { seq } };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/palettes/:id/ramp',
    handler: async (ctx) => {
      const paletteId = idParam(ctx, 'id');
      const { sprite, access } = await openPalette(ctx, paletteId);
      requireArtwork(access);
      const from = Number(ctx.body.from);
      const to = Number(ctx.body.to);
      if (from === 0) throw unprocessable({ from: TRANSPARENT_INDEX_TEXT });
      if (to === 0) throw unprocessable({ to: TRANSPARENT_INDEX_TEXT });
      const steps = wholeNumber(ctx, 'steps', { min: 3, max: 32, text: 'Use 3 to 32' });
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const swatches = await swatchesOf(opCtx.client, paletteId);
        const start = swatches.find((entry) => entry.index === from && entry.present);
        const end = swatches.find((entry) => entry.index === to && entry.present);
        if (start === undefined) throw unprocessable({ from: 'That swatch is gone' });
        if (end === undefined) throw unprocessable({ to: 'That swatch is gone' });
        const colours = rampColours(start.color, end.color, steps);
        const middle = colours.slice(1, colours.length - 1);
        const free = config.paletteMax - swatches.filter((entry) => entry.present).length;
        if (middle.length > free) throw unprocessable({ color: paletteLimitText() });
        const made: { index: number; color: string; version: number }[] = [
          { index: start.index, color: start.color, version: start.version },
        ];
        for (const colour of middle) {
          made.push(await addSwatch(opCtx.client, paletteId, colour, access.person.id));
        }
        made.push({ index: end.index, color: end.color, version: end.version });
        const seq = await recordOperation(opCtx, {
          type: 'palette',
          data: { action: 'ramp', added: middle.length },
        });
        opCtx.events.push({ type: 'op', seq, op: 'palette', by: access.person.name });
        return { status: 201, body: { swatches: made, seq } };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/palettes/:id/import',
    handler: async (ctx) => {
      const paletteId = idParam(ctx, 'id');
      const { sprite, access } = await openPalette(ctx, paletteId);
      requireArtwork(access);
      const fileName = String(ctx.body.file_name ?? '');
      const text = String(ctx.body.text ?? '');
      const parsed = parsePaletteFile(fileName, text);
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const swatches = await swatchesOf(opCtx.client, paletteId);
        const free = config.paletteMax - swatches.filter((entry) => entry.present).length;
        if (parsed.colours.length > free) throw unprocessable({ file: paletteLimitText() });
        for (const colour of parsed.colours) {
          await addSwatch(opCtx.client, paletteId, colour, access.person.id);
        }
        const seq = await recordOperation(opCtx, {
          type: 'palette',
          data: { action: 'import', added: parsed.colours.length },
        });
        opCtx.events.push({ type: 'op', seq, op: 'palette', by: access.person.name });
        return { status: 201, body: { added: parsed.colours.length, seq } };
      });
    },
  },
];
