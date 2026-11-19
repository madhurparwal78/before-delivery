import { formatColour, parseColour } from '../shared/colour.js';
import { overlay } from '../shared/composite.js';
import { openSprite, requireArtwork } from './access.js';
import { conflict, unprocessable } from './errors.js';
import type { Ctx, Reply } from './http.js';
import { clearStacks, recordOperation, spriteTransaction } from './ops.js';
import { addSwatch, nextFreeIndex } from './palette.js';
import { config } from './config.js';
import { first, rows } from './db.js';
import {
  celsOfFrame,
  colourMap,
  emptySurface,
  framesOf,
  layersOf,
  surfaceOf,
  swatchesOf,
} from './sprite.js';

/** Merging a layer into the one below it, on every frame, as one operation. */
export async function mergeDown(ctx: Ctx, spriteId: number, layerId: number): Promise<Reply> {
  const { sprite, access } = await openSprite(ctx, spriteId);
  requireArtwork(access);
  return spriteTransaction(sprite.id, access.person, async (opCtx) => {
    const layers = await layersOf(opCtx.client, sprite.id);
    const upper = layers.find((layer) => layer.id === layerId);
    if (upper === undefined) throw unprocessable({ layer: 'That layer is gone' });
    const lower = layers.find((layer) => layer.position === upper.position + 1);
    if (lower === undefined) throw unprocessable({ layer: 'No layer below' });
    for (const layer of [upper, lower]) {
      if (layer.locked_by !== null && layer.locked_by !== access.person.id) {
        throw conflict({ error: 'layer_locked', message: `Locked by ${layer.locked_name}` });
      }
    }

    const colours = await colourMap(opCtx.client, sprite.palette_id);
    const frames = await framesOf(opCtx.client, sprite.id);
    const cells = sprite.width * sprite.height;
    const results: string[][] = [];
    for (const frame of frames) {
      const cels = await celsOfFrame(opCtx.client, frame.id);
      const upperCel = cels.get(upper.id);
      const lowerCel = cels.get(lower.id);
      const upperSurface =
        upperCel === undefined
          ? emptySurface(sprite.width, sprite.height)
          : surfaceOf(upperCel.data, sprite.width, sprite.height);
      const lowerSurface =
        lowerCel === undefined
          ? emptySurface(sprite.width, sprite.height)
          : surfaceOf(lowerCel.data, sprite.width, sprite.height);
      const frameResult: string[] = [];
      for (let cell = 0; cell < cells; cell += 1) {
        let dest = parseColour('00000000');
        const lowerIndex = lowerSurface.indices[cell];
        if (lowerIndex !== 0) {
          dest = overlay(
            parseColour(colours.get(lowerIndex) ?? '00000000'),
            lower.opacity,
            lower.blend,
            dest,
          );
        }
        const upperIndex = upperSurface.indices[cell];
        if (upperIndex !== 0) {
          dest = overlay(
            parseColour(colours.get(upperIndex) ?? '00000000'),
            upper.opacity,
            upper.blend,
            dest,
          );
        }
        frameResult.push(dest[3] === 0 ? '00000000' : formatColour(dest));
      }
      results.push(frameResult);
    }

    const swatches = await swatchesOf(opCtx.client, sprite.palette_id);
    const byColour = new Map<string, number>();
    for (const swatch of swatches) {
      if (!swatch.present) continue;
      const seen = byColour.get(swatch.color);
      if (seen === undefined || swatch.index < seen) byColour.set(swatch.color, swatch.index);
    }
    const needed: string[] = [];
    for (const frameResult of results) {
      for (const colour of frameResult) {
        if (colour === '00000000') continue;
        if (byColour.has(colour) || needed.includes(colour)) continue;
        needed.push(colour);
      }
    }
    const free = config.paletteMax - swatches.filter((swatch) => swatch.present).length;
    if (needed.length > free) {
      throw conflict({
        error: 'palette_full',
        message: `Needs ${ctx.num(needed.length)} new ${needed.length === 1 ? 'swatch' : 'swatches'}, ${ctx.num(free)} free`,
      });
    }
    for (const colour of needed) {
      const made = await addSwatch(opCtx.client, sprite.palette_id, colour, access.person.id);
      byColour.set(colour, made.index);
    }

    for (let at = 0; at < frames.length; at += 1) {
      const frame = frames[at];
      const data = Buffer.alloc(cells);
      results[at].forEach((colour, cell) => {
        data[cell] = colour === '00000000' ? 0 : byColour.get(colour) ?? 0;
      });
      const made = await first<{ id: number }>(
        opCtx.client,
        'INSERT INTO buffers (sprite_id, data) VALUES ($1, $2) RETURNING id',
        [sprite.id, data],
      );
      await opCtx.client.query(
        `INSERT INTO cels (frame_id, layer_id, buffer_id) VALUES ($1, $2, $3)
         ON CONFLICT (frame_id, layer_id) DO UPDATE SET buffer_id = $3`,
        [frame.id, lower.id, (made as { id: number }).id],
      );
    }

    await opCtx.client.query(
      "UPDATE layers SET opacity = 100, blend = 'normal' WHERE id = $1",
      [lower.id],
    );
    await opCtx.client.query('DELETE FROM layers WHERE id = $1', [upper.id]);
    const remaining = await rows<{ id: number; position: number }>(
      opCtx.client,
      'SELECT id, position FROM layers WHERE sprite_id = $1 ORDER BY position',
      [sprite.id],
    );
    for (let at = 0; at < remaining.length; at += 1) {
      await opCtx.client.query('UPDATE layers SET position = $2 WHERE id = $1', [
        remaining[at].id,
        at + 1,
      ]);
    }
    await clearStacks(opCtx);
    const seq = await recordOperation(opCtx, {
      type: 'layer',
      data: { action: 'merge', into: lower.name, new_swatches: needed.length },
    });
    opCtx.events.push({
      type: 'op',
      seq,
      op: 'layer',
      by: access.person.name,
      data: { action: 'merge', into: lower.name, new_swatches: needed.length },
    });
    return { status: 200, body: { seq, new_swatches: needed.length } };
  });
}

export { nextFreeIndex };
