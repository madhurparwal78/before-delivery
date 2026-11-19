import { bytesToColourRows } from '../../shared/composite.js';
import type { Blend, TagDirection } from '../../shared/types.js';
import { openProject, openSprite, requireArtwork } from '../access.js';
import { instant, now } from '../clock.js';
import { config } from '../config.js';
import { first, query, rows, transact } from '../db.js';
import { conflict, forbidden, notFound, unprocessable } from '../errors.js';
import type { Ctx, Route } from '../http.js';
import { closeStream, openStream, publishSprite } from '../live.js';
import { mergeDown } from '../merge.js';
import { recordOperation, spriteTransaction } from '../ops.js';
import { join, leave, noteActivity, presenceList } from '../presence.js';
import {
  celsOfFrame,
  colourMap,
  compositeBytes,
  emptySurface,
  framesOf,
  layersOf,
  surfaceOf,
} from '../sprite.js';
import { choice, idParam, optionalWholeNumber, text, wholeNumber } from '../validate.js';
import type { PoolClient } from 'pg';

async function frameByNumber(
  client: PoolClient,
  spriteId: number,
  number: number,
  missing: 'field' | 'hidden' = 'field',
): Promise<{ id: number; number: number; duration_ms: number }> {
  const frame = await first<{ id: number; number: number; duration_ms: number }>(
    client,
    'SELECT id, number, duration_ms FROM frames WHERE sprite_id = $1 AND number = $2',
    [spriteId, number],
  );
  if (frame === null) {
    throw missing === 'hidden' ? notFound() : unprocessable({ frame: 'That frame is gone' });
  }
  return frame;
}

export async function layerByName(
  client: PoolClient,
  spriteId: number,
  name: string,
): Promise<{ id: number; name: string; locked_by: number | null; position: number }> {
  const layer = await first<{ id: number; name: string; locked_by: number | null; position: number }>(
    client,
    'SELECT id, name, locked_by, position FROM layers WHERE sprite_id = $1 AND name = $2',
    [spriteId, name],
  );
  if (layer === null) throw unprocessable({ layer: 'That layer is gone' });
  return layer;
}

function durationText(ctx: Ctx): string {
  return `Use ${ctx.num(config.frameMinMs)} to ${ctx.num(config.frameMaxMs)} ms`;
}

export const spriteRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/projects/:id/sprites',
    handler: async (ctx) => {
      const access = await openProject(ctx, idParam(ctx, 'id'));
      requireArtwork(access);
      const name = text(ctx, 'name', { max: 120, label: 'Name this sprite' });
      const limitText = `Largest size is ${ctx.num(config.spriteMax)}`;
      const width = wholeNumber(ctx, 'width', { min: 1, max: config.spriteMax, text: limitText });
      const height = wholeNumber(ctx, 'height', { min: 1, max: config.spriteMax, text: limitText });
      const at = await now();
      const made = await transact(async (client) => {
        const palette = await first<{ id: number }>(
          client,
          'INSERT INTO palettes (created_at) VALUES ($1) RETURNING id',
          [at],
        );
        const paletteId = (palette as { id: number }).id;
        const sprite = await first<{ id: number }>(
          client,
          `INSERT INTO sprites (project_id, palette_id, name, width, height, seq, created_at)
           VALUES ($1, $2, $3, $4, $5, 0, $6) RETURNING id`,
          [access.project.id, paletteId, name, width, height, at],
        );
        const spriteId = (sprite as { id: number }).id;
        await client.query(
          'INSERT INTO layers (sprite_id, name, opacity, blend, visible, position) VALUES ($1, $2, 100, $3, true, 1)',
          [spriteId, 'Layer 1', 'normal'],
        );
        await client.query('INSERT INTO frames (sprite_id, number, duration_ms) VALUES ($1, 1, $2)', [
          spriteId,
          Math.min(Math.max(100, config.frameMinMs), config.frameMaxMs),
        ]);
        return { id: spriteId, palette: paletteId };
      });
      return { status: 201, body: { id: made.id, palette: made.palette, seq: 0 } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/sprites/:id',
    handler: async (ctx) => {
      const { sprite } = await openSprite(ctx, idParam(ctx, 'id'));
      return { status: 200, body: await spriteBody(sprite.id) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/sprites/:id/frames/:n/pixels',
    handler: async (ctx) => {
      const { sprite } = await openSprite(ctx, idParam(ctx, 'id'));
      const layerName = ctx.url.searchParams.get('layer');
      return transact(async (client) => {
        const frame = await frameByNumber(client, sprite.id, idParam(ctx, 'n'), 'hidden');
        if (layerName === null) {
          const bytes = await compositeBytes(client, sprite, frame.id);
          return {
            status: 200,
            body: {
              width: sprite.width,
              height: sprite.height,
              seq: sprite.seq,
              rows: bytesToColourRows(bytes, sprite.width, sprite.height),
            },
          };
        }
        const layer = await layerByName(client, sprite.id, layerName);
        const cels = await celsOfFrame(client, frame.id);
        const cel = cels.get(layer.id);
        const surface =
          cel === undefined
            ? emptySurface(sprite.width, sprite.height)
            : surfaceOf(cel.data, sprite.width, sprite.height);
        const colours = await colourMap(client, sprite.palette_id);
        const pixelRows: string[][] = [];
        for (let y = 0; y < sprite.height; y += 1) {
          const row: string[] = [];
          for (let x = 0; x < sprite.width; x += 1) {
            const index = surface.indices[y * sprite.width + x];
            row.push(index === 0 ? '00000000' : colours.get(index) ?? '00000000');
          }
          pixelRows.push(row);
        }
        return {
          status: 200,
          body: { width: sprite.width, height: sprite.height, seq: sprite.seq, rows: pixelRows },
        };
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/sprites/:id/frames/:n/indices',
    handler: async (ctx) => {
      const { sprite } = await openSprite(ctx, idParam(ctx, 'id'));
      const layerName = ctx.url.searchParams.get('layer');
      if (layerName === null) throw unprocessable({ layer: 'Name a layer' });
      return transact(async (client) => {
        const frame = await frameByNumber(client, sprite.id, idParam(ctx, 'n'), 'hidden');
        const layer = await layerByName(client, sprite.id, layerName);
        const cel = (await celsOfFrame(client, frame.id)).get(layer.id);
        const surface =
          cel === undefined
            ? emptySurface(sprite.width, sprite.height)
            : surfaceOf(cel.data, sprite.width, sprite.height);
        const indexRows: number[][] = [];
        for (let y = 0; y < sprite.height; y += 1) {
          const row: number[] = [];
          for (let x = 0; x < sprite.width; x += 1) row.push(surface.indices[y * sprite.width + x]);
          indexRows.push(row);
        }
        const linked =
          cel === undefined
            ? []
            : (
                await rows<{ number: number }>(
                  client,
                  `SELECT f.number FROM cels c JOIN frames f ON f.id = c.frame_id
                    WHERE c.buffer_id = $1 AND c.layer_id = $2 ORDER BY f.number`,
                  [cel.buffer_id, layer.id],
                )
              ).map((row) => row.number);
        return {
          status: 200,
          body: {
            width: sprite.width,
            height: sprite.height,
            seq: sprite.seq,
            rows: indexRows,
            linked_frames: linked.length > 1 ? linked : [],
          },
        };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/sprites/:id/layers',
    handler: async (ctx) => {
      const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
      requireArtwork(access);
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const existing = await layersOf(opCtx.client, sprite.id);
        const name =
          ctx.body.name === undefined || String(ctx.body.name).trim() === ''
            ? `Layer ${existing.length + 1}`
            : String(ctx.body.name).trim();
        if (existing.some((layer) => layer.name === name)) {
          throw unprocessable({ name: 'That name is taken' });
        }
        await opCtx.client.query('UPDATE layers SET position = position + 1 WHERE sprite_id = $1', [
          sprite.id,
        ]);
        const made = await first<{ id: number }>(
          opCtx.client,
          `INSERT INTO layers (sprite_id, name, opacity, blend, visible, position)
           VALUES ($1, $2, 100, 'normal', true, 1) RETURNING id`,
          [sprite.id, name],
        );
        const seq = await recordOperation(opCtx, { type: 'layer', data: { action: 'add', name } });
        opCtx.events.push({ type: 'op', seq, op: 'layer', by: access.person.name });
        return { status: 201, body: { id: (made as { id: number }).id, name, seq } };
      });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/sprites/:id/layers/:layerId',
    handler: async (ctx) => {
      const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
      requireArtwork(access);
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const layerId = idParam(ctx, 'layerId');
        const layer = await first<{ id: number; position: number; name: string }>(
          opCtx.client,
          'SELECT id, position, name FROM layers WHERE id = $1 AND sprite_id = $2',
          [layerId, sprite.id],
        );
        if (layer === null) throw notFound();
        const all = await layersOf(opCtx.client, sprite.id);
        if (ctx.body.opacity !== undefined) {
          const opacity = wholeNumber(ctx, 'opacity', { min: 0, max: 100, text: 'Use 0 to 100' });
          await opCtx.client.query('UPDATE layers SET opacity = $2 WHERE id = $1', [layerId, opacity]);
        }
        if (ctx.body.blend !== undefined) {
          const blend = choice(ctx, 'blend', ['normal', 'multiply'] as const) as Blend;
          await opCtx.client.query('UPDATE layers SET blend = $2 WHERE id = $1', [layerId, blend]);
        }
        if (ctx.body.visible !== undefined) {
          if (typeof ctx.body.visible !== 'boolean') {
            throw unprocessable({ visible: 'Use true or false' });
          }
          await opCtx.client.query('UPDATE layers SET visible = $2 WHERE id = $1', [
            layerId,
            ctx.body.visible,
          ]);
        }
        if (ctx.body.position !== undefined) {
          const position = wholeNumber(ctx, 'position', {
            min: 1,
            max: all.length,
            text: `Use 1 to ${ctx.num(all.length)}`,
          });
          const ordered = [...all].sort((l, r) => l.position - r.position).map((item) => item.id);
          const from = ordered.indexOf(layerId);
          ordered.splice(from, 1);
          ordered.splice(position - 1, 0, layerId);
          for (let at = 0; at < ordered.length; at += 1) {
            await opCtx.client.query('UPDATE layers SET position = $2 WHERE id = $1', [
              ordered[at],
              at + 1,
            ]);
          }
        }
        const seq = await recordOperation(opCtx, {
          type: 'layer',
          data: { action: 'update', layer: layer.name },
        });
        opCtx.events.push({ type: 'op', seq, op: 'layer', by: access.person.name });
        return { status: 200, body: { seq } };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/sprites/:id/layers/:layerId/lock',
    handler: async (ctx) => {
      const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
      requireArtwork(access);
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const layerId = idParam(ctx, 'layerId');
        const layer = await first<{ id: number; name: string; locked_by: number | null }>(
          opCtx.client,
          'SELECT id, name, locked_by FROM layers WHERE id = $1 AND sprite_id = $2',
          [layerId, sprite.id],
        );
        if (layer === null) throw notFound();
        if (layer.locked_by !== null && layer.locked_by !== access.person.id) {
          const holder = await first<{ name: string }>(opCtx.client, 'SELECT name FROM users WHERE id = $1', [
            layer.locked_by,
          ]);
          throw conflict({
            error: 'layer_locked',
            message: `Locked by ${(holder as { name: string }).name}`,
          });
        }
        await opCtx.client.query('UPDATE layers SET locked_by = $2 WHERE id = $1', [
          layerId,
          access.person.id,
        ]);
        const seq = await recordOperation(opCtx, {
          type: 'layer',
          data: { action: 'lock', layer: layer.name, holder: access.person.name },
        });
        opCtx.events.push({ type: 'op', seq, op: 'layer', by: access.person.name });
        return { status: 200, body: { locked_by: access.person.name, seq } };
      });
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/sprites/:id/layers/:layerId/lock',
    handler: async (ctx) => {
      const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
      requireArtwork(access);
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const layerId = idParam(ctx, 'layerId');
        const layer = await first<{ id: number; name: string; locked_by: number | null }>(
          opCtx.client,
          'SELECT id, name, locked_by FROM layers WHERE id = $1 AND sprite_id = $2',
          [layerId, sprite.id],
        );
        if (layer === null) throw notFound();
        if (
          layer.locked_by !== null &&
          layer.locked_by !== access.person.id &&
          access.role !== 'owner'
        ) {
          throw forbidden('Only the holder or the owner can unlock');
        }
        await opCtx.client.query('UPDATE layers SET locked_by = NULL WHERE id = $1', [layerId]);
        const seq = await recordOperation(opCtx, {
          type: 'layer',
          data: { action: 'unlock', layer: layer.name },
        });
        opCtx.events.push({ type: 'op', seq, op: 'layer', by: access.person.name });
        return { status: 200, body: { seq } };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/sprites/:id/layers/:layerId/merge-down',
    handler: async (ctx) => mergeDown(ctx, idParam(ctx, 'id'), idParam(ctx, 'layerId')),
  },
  {
    method: 'POST',
    pattern: '/api/sprites/:id/frames',
    handler: async (ctx) => {
      const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
      requireArtwork(access);
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const frames = await framesOf(opCtx.client, sprite.id);
        const duration = optionalWholeNumber(ctx, 'duration_ms', {
          min: config.frameMinMs,
          max: config.frameMaxMs,
          text: durationText(ctx),
          fallback: Math.min(Math.max(100, config.frameMinMs), config.frameMaxMs),
        });
        const position = optionalWholeNumber(ctx, 'position', {
          min: 1,
          max: frames.length + 1,
          text: `Use 1 to ${ctx.num(frames.length + 1)}`,
          fallback: frames.length + 1,
        });
        await opCtx.client.query(
          'UPDATE frames SET number = number + 1 WHERE sprite_id = $1 AND number >= $2',
          [sprite.id, position],
        );
        await opCtx.client.query(
          'INSERT INTO frames (sprite_id, number, duration_ms) VALUES ($1, $2, $3)',
          [sprite.id, position, duration],
        );
        const seq = await recordOperation(opCtx, {
          type: 'frame',
          data: { action: 'add', number: position },
        });
        opCtx.events.push({ type: 'op', seq, op: 'frame', by: access.person.name, data: { action: 'add', number: position } });
        return { status: 201, body: { number: position, seq } };
      });
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/sprites/:id/frames/:n',
    handler: async (ctx) => {
      const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
      requireArtwork(access);
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const frames = await framesOf(opCtx.client, sprite.id);
        const frame = await frameByNumber(opCtx.client, sprite.id, idParam(ctx, 'n'));
        if (ctx.body.duration_ms !== undefined) {
          const duration = wholeNumber(ctx, 'duration_ms', {
            min: config.frameMinMs,
            max: config.frameMaxMs,
            text: durationText(ctx),
          });
          await opCtx.client.query('UPDATE frames SET duration_ms = $2 WHERE id = $1', [
            frame.id,
            duration,
          ]);
        }
        if (ctx.body.position !== undefined) {
          const position = wholeNumber(ctx, 'position', {
            min: 1,
            max: frames.length,
            text: `Use 1 to ${ctx.num(frames.length)}`,
          });
          const ordered = frames.map((item) => item.id);
          const from = ordered.indexOf(frame.id);
          ordered.splice(from, 1);
          ordered.splice(position - 1, 0, frame.id);
          for (let at = 0; at < ordered.length; at += 1) {
            await opCtx.client.query('UPDATE frames SET number = $2 WHERE id = $1', [
              ordered[at],
              at + 1,
            ]);
          }
        }
        const seq = await recordOperation(opCtx, {
          type: 'frame',
          data: { action: 'update', number: frame.number },
        });
        opCtx.events.push({ type: 'op', seq, op: 'frame', by: access.person.name });
        return { status: 200, body: { seq } };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/sprites/:id/frames/:n/cels/link',
    handler: async (ctx) => {
      const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
      requireArtwork(access);
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const frame = await frameByNumber(opCtx.client, sprite.id, idParam(ctx, 'n'));
        const layer = await layerByName(opCtx.client, sprite.id, String(ctx.body.layer ?? ''));
        const toNumber = Number(ctx.body.to_frame);
        if (!Number.isInteger(toNumber) || toNumber === frame.number) {
          throw unprocessable({ to_frame: 'Choose another frame' });
        }
        const target = await first<{ id: number }>(
          opCtx.client,
          'SELECT id FROM frames WHERE sprite_id = $1 AND number = $2',
          [sprite.id, toNumber],
        );
        if (target === null) throw unprocessable({ to_frame: 'Choose another frame' });
        const targetCel = await first<{ buffer_id: number }>(
          opCtx.client,
          'SELECT buffer_id FROM cels WHERE frame_id = $1 AND layer_id = $2',
          [target.id, layer.id],
        );
        let bufferId = targetCel?.buffer_id ?? null;
        if (bufferId === null) {
          const made = await first<{ id: number }>(
            opCtx.client,
            'INSERT INTO buffers (sprite_id, data) VALUES ($1, $2) RETURNING id',
            [sprite.id, Buffer.alloc(sprite.width * sprite.height)],
          );
          bufferId = (made as { id: number }).id;
          await opCtx.client.query(
            'INSERT INTO cels (frame_id, layer_id, buffer_id) VALUES ($1, $2, $3)',
            [target.id, layer.id, bufferId],
          );
        }
        await opCtx.client.query(
          `INSERT INTO cels (frame_id, layer_id, buffer_id) VALUES ($1, $2, $3)
           ON CONFLICT (frame_id, layer_id) DO UPDATE SET buffer_id = $3`,
          [frame.id, layer.id, bufferId],
        );
        const seq = await recordOperation(opCtx, {
          type: 'cel',
          data: { action: 'link', frame: frame.number, layer: layer.name, to_frame: toNumber },
        });
        opCtx.events.push({ type: 'op', seq, op: 'cel', by: access.person.name });
        return { status: 200, body: { seq } };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/sprites/:id/frames/:n/cels/unlink',
    handler: async (ctx) => {
      const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
      requireArtwork(access);
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const frame = await frameByNumber(opCtx.client, sprite.id, idParam(ctx, 'n'));
        const layer = await layerByName(opCtx.client, sprite.id, String(ctx.body.layer ?? ''));
        const cel = await first<{ buffer_id: number }>(
          opCtx.client,
          'SELECT buffer_id FROM cels WHERE frame_id = $1 AND layer_id = $2',
          [frame.id, layer.id],
        );
        if (cel === null) throw conflict({ error: 'not_linked' });
        const sharers = await rows<{ frame_id: number }>(
          opCtx.client,
          'SELECT frame_id FROM cels WHERE buffer_id = $1 AND layer_id = $2',
          [cel.buffer_id, layer.id],
        );
        if (sharers.length < 2) throw conflict({ error: 'not_linked' });
        const source = await first<{ data: Buffer }>(opCtx.client, 'SELECT data FROM buffers WHERE id = $1', [
          cel.buffer_id,
        ]);
        const made = await first<{ id: number }>(
          opCtx.client,
          'INSERT INTO buffers (sprite_id, data) VALUES ($1, $2) RETURNING id',
          [sprite.id, (source as { data: Buffer }).data],
        );
        await opCtx.client.query('UPDATE cels SET buffer_id = $3 WHERE frame_id = $1 AND layer_id = $2', [
          frame.id,
          layer.id,
          (made as { id: number }).id,
        ]);
        const seq = await recordOperation(opCtx, {
          type: 'cel',
          data: { action: 'unlink', frame: frame.number, layer: layer.name },
        });
        opCtx.events.push({ type: 'op', seq, op: 'cel', by: access.person.name });
        return { status: 200, body: { seq } };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/sprites/:id/tags',
    handler: async (ctx) => {
      const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
      requireArtwork(access);
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const frames = await framesOf(opCtx.client, sprite.id);
        const name = text(ctx, 'name', { max: 60, label: 'Name this tag' });
        const from = wholeNumber(ctx, 'from', {
          min: 1,
          max: frames.length,
          text: `Use 1 to ${ctx.num(frames.length)}`,
        });
        const to = wholeNumber(ctx, 'to', {
          min: from,
          max: frames.length,
          text: `Use ${ctx.num(from)} to ${ctx.num(frames.length)}`,
        });
        const direction = choice(ctx, 'direction', [
          'forward',
          'reverse',
          'pingpong',
        ] as const) as TagDirection;
        const repeat = optionalWholeNumber(ctx, 'repeat', {
          min: 0,
          max: 99,
          text: 'Use 0 to 99',
          fallback: 0,
        });
        const made = await first<{ id: number }>(
          opCtx.client,
          `INSERT INTO tags (sprite_id, name, from_frame, to_frame, direction, repeat)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [sprite.id, name, from, to, direction, repeat],
        );
        const seq = await recordOperation(opCtx, { type: 'tag', data: { action: 'add', name } });
        opCtx.events.push({ type: 'op', seq, op: 'tag', by: access.person.name });
        return { status: 201, body: { id: (made as { id: number }).id, seq } };
      });
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/sprites/:id/tags/:tagId',
    handler: async (ctx) => {
      const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
      requireArtwork(access);
      return spriteTransaction(sprite.id, access.person, async (opCtx) => {
        const tag = await first<{ id: number; name: string }>(
          opCtx.client,
          'SELECT id, name FROM tags WHERE id = $1 AND sprite_id = $2',
          [idParam(ctx, 'tagId'), sprite.id],
        );
        if (tag === null) throw notFound();
        await opCtx.client.query('DELETE FROM tags WHERE id = $1', [tag.id]);
        const seq = await recordOperation(opCtx, {
          type: 'tag',
          data: { action: 'remove', name: tag.name },
        });
        opCtx.events.push({ type: 'op', seq, op: 'tag', by: access.person.name });
        return { status: 200, body: { seq } };
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/sprites/:id/events',
    handler: async (ctx) => {
      const { sprite } = await openSprite(ctx, idParam(ctx, 'id'));
      const since = Number(ctx.url.searchParams.get('since') ?? '0');
      const list = await query<{
        seq: number;
        type: string;
        by_name: string;
        at: Date;
        data: Record<string, unknown>;
      }>(
        `SELECT seq, type, by_name, at, data FROM operations
          WHERE sprite_id = $1 AND seq > $2 ORDER BY seq`,
        [sprite.id, Number.isFinite(since) ? since : 0],
      );
      return {
        status: 200,
        body: {
          events: list.map((row) => ({
            seq: row.seq,
            type: row.type,
            by: row.by_name,
            at: instant(row.at),
            data: row.data,
          })),
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/sprites/:id/cels',
    handler: async (ctx) => {
      const { sprite } = await openSprite(ctx, idParam(ctx, 'id'));
      return transact(async (client) => {
        const layers = await layersOf(client, sprite.id);
        const frames = await framesOf(client, sprite.id);
        const out: { number: number; layers: Record<string, string> }[] = [];
        for (const frame of frames) {
          const cels = await celsOfFrame(client, frame.id);
          const layerData: Record<string, string> = {};
          for (const layer of layers) {
            const cel = cels.get(layer.id);
            layerData[layer.name] =
              cel === undefined
                ? Buffer.alloc(sprite.width * sprite.height).toString('base64')
                : cel.data.toString('base64');
          }
          out.push({ number: frame.number, layers: layerData });
        }
        return {
          status: 200,
          body: { width: sprite.width, height: sprite.height, seq: sprite.seq, frames: out },
        };
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/sprites/:id/cursor',
    handler: async (ctx) => {
      const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
      const x = Number(ctx.body.x ?? 0);
      const y = Number(ctx.body.y ?? 0);
      const frame = Number(ctx.body.frame ?? 1);
      const at = await now();
      noteActivity(sprite.id, access.person.id, at.getTime(), { x, y, frame });
      publishSprite(sprite.id, {
        type: 'cursor',
        person: access.person.name,
        person_id: access.person.id,
        x,
        y,
        frame,
      });
      return { status: 204 };
    },
  },
  {
    method: 'GET',
    pattern: '/api/sprites/:id/live',
    raw: true,
    handler: async (ctx) => {
      const { sprite, access } = await openSprite(ctx, idParam(ctx, 'id'));
      const at = await now();
      const client = openStream(ctx.res, {
        spriteId: sprite.id,
        projectId: sprite.project_id,
        personId: access.person.id,
      });
      join(sprite.id, access.person.id, access.person.name, at.getTime());
      ctx.req.on('close', () => {
        void (async () => {
          closeStream(client);
          leave(sprite.id, access.person.id, (await now()).getTime());
        })();
      });
    },
  },
  {
    method: 'GET',
    pattern: '/api/sprites/:id/presence',
    handler: async (ctx) => {
      const { sprite } = await openSprite(ctx, idParam(ctx, 'id'));
      const at = await now();
      return { status: 200, body: presenceList(sprite.id, at.getTime()) };
    },
  },
];

/** The sprite body the API publishes, used by routes and by the workspace load. */
export async function spriteBody(spriteId: number): Promise<Record<string, unknown>> {
  return transact(async (client) => {
    const sprite = await first<{
      id: number;
      name: string;
      width: number;
      height: number;
      seq: number;
      palette_id: number;
    }>(client, 'SELECT id, name, width, height, seq, palette_id FROM sprites WHERE id = $1', [spriteId]);
    if (sprite === null) throw notFound();
    const layers = await layersOf(client, spriteId);
    const frames = await framesOf(client, spriteId);
    const linkedByFrame = new Map<number, string[]>();
    const shared = await rows<{ frame_id: number; layer_id: number; buffer_id: number }>(
      client,
      `SELECT c.frame_id, c.layer_id, c.buffer_id FROM cels c JOIN frames f ON f.id = c.frame_id
        WHERE f.sprite_id = $1`,
      [spriteId],
    );
    const bufferCount = new Map<number, number>();
    for (const cel of shared) bufferCount.set(cel.buffer_id, (bufferCount.get(cel.buffer_id) ?? 0) + 1);
    const layerName = new Map(layers.map((layer) => [layer.id, layer.name]));
    for (const cel of shared) {
      if ((bufferCount.get(cel.buffer_id) ?? 0) < 2) continue;
      const list = linkedByFrame.get(cel.frame_id) ?? [];
      list.push(layerName.get(cel.layer_id) ?? '');
      linkedByFrame.set(cel.frame_id, list);
    }
    const tags = await rows<{
      id: number;
      name: string;
      from_frame: number;
      to_frame: number;
      direction: string;
      repeat: number;
    }>(client, 'SELECT id, name, from_frame, to_frame, direction, repeat FROM tags WHERE sprite_id = $1 ORDER BY id', [
      spriteId,
    ]);
    const tilesets = await rows<{ id: number }>(
      client,
      'SELECT id FROM tilesets WHERE sprite_id = $1 ORDER BY id',
      [spriteId],
    );
    const tilemaps = await rows<{ id: number }>(
      client,
      'SELECT id FROM tilemaps WHERE sprite_id = $1 ORDER BY id',
      [spriteId],
    );
    return {
      id: sprite.id,
      name: sprite.name,
      width: sprite.width,
      height: sprite.height,
      seq: sprite.seq,
      palette: sprite.palette_id,
      layers: [...layers]
        .sort((l, r) => l.position - r.position)
        .map((layer) => ({
          id: layer.id,
          name: layer.name,
          opacity: layer.opacity,
          blend: layer.blend,
          visible: layer.visible,
          locked_by: layer.locked_name,
          position: layer.position,
        })),
      frames: frames.map((frame) => ({
        number: frame.number,
        duration_ms: frame.duration_ms,
        linked_layers: linkedByFrame.get(frame.id) ?? [],
      })),
      tags: tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        from: tag.from_frame,
        to: tag.to_frame,
        direction: tag.direction,
        repeat: tag.repeat,
      })),
      tilesets: tilesets.map((row) => row.id),
      tilemaps: tilemaps.map((row) => row.id),
    };
  });
}

export { frameByNumber };
