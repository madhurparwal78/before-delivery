import type { PoolClient } from 'pg';
import { compositeFrame, type CompositeLayer } from '../shared/composite.js';
import { flipTileRows } from '../shared/edges.js';
import type { Blend, Surface } from '../shared/types.js';
import { first, rows } from './db.js';
import type { SpriteRow } from './access.js';

export interface LayerRow {
  id: number;
  name: string;
  opacity: number;
  blend: Blend;
  visible: boolean;
  locked_by: number | null;
  locked_name: string | null;
  position: number;
}

export interface FrameRow {
  id: number;
  number: number;
  duration_ms: number;
}

export interface SwatchRow {
  index: number;
  color: string;
  version: number;
  present: boolean;
  edited_by_name: string | null;
  removed_by_name: string | null;
}

export async function spriteById(client: PoolClient, spriteId: number): Promise<SpriteRow> {
  const sprite = await first<SpriteRow>(
    client,
    'SELECT id, project_id, palette_id, name, width, height, seq FROM sprites WHERE id = $1',
    [spriteId],
  );
  if (sprite === null) throw new Error(`sprite ${spriteId} is gone`);
  return sprite;
}

/** Layers bottom first, which is the order the composite uses. */
export async function layersOf(client: PoolClient, spriteId: number): Promise<LayerRow[]> {
  return rows<LayerRow>(
    client,
    `SELECT l.id, l.name, l.opacity, l.blend, l.visible, l.locked_by, u.name AS locked_name, l.position
       FROM layers l LEFT JOIN users u ON u.id = l.locked_by
      WHERE l.sprite_id = $1
      ORDER BY l.position DESC`,
    [spriteId],
  );
}

export async function framesOf(client: PoolClient, spriteId: number): Promise<FrameRow[]> {
  return rows<FrameRow>(
    client,
    'SELECT id, number, duration_ms FROM frames WHERE sprite_id = $1 ORDER BY number',
    [spriteId],
  );
}

export async function swatchesOf(client: PoolClient, paletteId: number): Promise<SwatchRow[]> {
  return rows<SwatchRow>(
    client,
    `SELECT s.index, s.color, s.version, s.present, e.name AS edited_by_name, r.name AS removed_by_name
       FROM swatches s
       LEFT JOIN users e ON e.id = s.edited_by
       LEFT JOIN users r ON r.id = s.removed_by
      WHERE s.palette_id = $1
      ORDER BY s.index`,
    [paletteId],
  );
}

export async function colourMap(client: PoolClient, paletteId: number): Promise<Map<number, string>> {
  const swatches = await swatchesOf(client, paletteId);
  const map = new Map<number, string>();
  for (const swatch of swatches) if (swatch.present) map.set(swatch.index, swatch.color);
  return map;
}

export interface CelRow {
  layer_id: number;
  buffer_id: number;
  data: Buffer;
}

export async function celsOfFrame(client: PoolClient, frameId: number): Promise<Map<number, CelRow>> {
  const list = await rows<CelRow>(
    client,
    `SELECT c.layer_id, c.buffer_id, b.data
       FROM cels c JOIN buffers b ON b.id = c.buffer_id
      WHERE c.frame_id = $1`,
    [frameId],
  );
  return new Map(list.map((cel) => [cel.layer_id, cel]));
}

export function emptySurface(width: number, height: number): Surface {
  return { width, height, indices: new Uint8Array(width * height) };
}

export function surfaceOf(data: Buffer, width: number, height: number): Surface {
  const indices = new Uint8Array(width * height);
  indices.set(new Uint8Array(data.buffer, data.byteOffset, Math.min(data.length, indices.length)));
  return { width, height, indices };
}

export async function compositeLayers(
  client: PoolClient,
  sprite: SpriteRow,
  frameId: number,
  options: { ignoreVisibility?: boolean } = {},
): Promise<{ layers: CompositeLayer[]; colours: Map<number, string> }> {
  const layers = await layersOf(client, sprite.id);
  const cels = await celsOfFrame(client, frameId);
  const colours = await colourMap(client, sprite.palette_id);
  const built: CompositeLayer[] = layers.map((layer) => {
    const cel = cels.get(layer.id);
    return {
      surface:
        cel === undefined
          ? emptySurface(sprite.width, sprite.height)
          : surfaceOf(cel.data, sprite.width, sprite.height),
      opacity: layer.opacity,
      blend: layer.blend,
      visible: options.ignoreVisibility === true ? true : layer.visible,
    };
  });
  return { layers: built, colours };
}

export async function compositeBytes(
  client: PoolClient,
  sprite: SpriteRow,
  frameId: number,
): Promise<Uint8Array> {
  const { layers, colours } = await compositeLayers(client, sprite, frameId);
  return compositeFrame(layers, colours, sprite.width, sprite.height);
}

/** The cel buffer for one frame and layer, made when a write first needs it. */
export async function ensureBuffer(
  client: PoolClient,
  sprite: SpriteRow,
  frameId: number,
  layerId: number,
): Promise<{ bufferId: number; surface: Surface }> {
  const existing = await first<{ buffer_id: number; data: Buffer }>(
    client,
    `SELECT c.buffer_id, b.data FROM cels c JOIN buffers b ON b.id = c.buffer_id
      WHERE c.frame_id = $1 AND c.layer_id = $2`,
    [frameId, layerId],
  );
  if (existing !== null) {
    return {
      bufferId: existing.buffer_id,
      surface: surfaceOf(existing.data, sprite.width, sprite.height),
    };
  }
  const made = await first<{ id: number }>(
    client,
    'INSERT INTO buffers (sprite_id, data) VALUES ($1, $2) RETURNING id',
    [sprite.id, Buffer.alloc(sprite.width * sprite.height)],
  );
  const bufferId = (made as { id: number }).id;
  await client.query('INSERT INTO cels (frame_id, layer_id, buffer_id) VALUES ($1, $2, $3)', [
    frameId,
    layerId,
    bufferId,
  ]);
  return { bufferId, surface: emptySurface(sprite.width, sprite.height) };
}

export async function readBuffer(client: PoolClient, bufferId: number, width: number, height: number): Promise<Surface> {
  const row = await first<{ data: Buffer }>(client, 'SELECT data FROM buffers WHERE id = $1', [bufferId]);
  return surfaceOf((row as { data: Buffer }).data, width, height);
}

export async function writeBuffer(client: PoolClient, bufferId: number, surface: Surface): Promise<void> {
  await client.query('UPDATE buffers SET data = $2 WHERE id = $1', [
    bufferId,
    Buffer.from(surface.indices),
  ]);
}

export interface SwatchUsage {
  pixels: number;
  frames: number;
}

/**
 * A swatch's true count: cel cells across all frames and layers with a linked
 * cel counted once, plus tile cells with each tile counted once.
 */
export async function swatchUsage(
  client: PoolClient,
  sprite: SpriteRow,
): Promise<Map<number, SwatchUsage>> {
  const usage = new Map<number, SwatchUsage>();
  const add = (index: number, pixels: number): void => {
    if (index === 0) return;
    const entry = usage.get(index) ?? { pixels: 0, frames: 0 };
    entry.pixels += pixels;
    usage.set(index, entry);
  };

  const cels = await rows<{ buffer_id: number; frame_id: number; data: Buffer }>(
    client,
    `SELECT c.buffer_id, c.frame_id, b.data
       FROM cels c JOIN buffers b ON b.id = c.buffer_id JOIN frames f ON f.id = c.frame_id
      WHERE f.sprite_id = $1`,
    [sprite.id],
  );
  const countedBuffers = new Set<number>();
  const framesByIndex = new Map<number, Set<number>>();
  for (const cel of cels) {
    const perIndex = new Map<number, number>();
    for (const index of cel.data) {
      if (index === 0) continue;
      perIndex.set(index, (perIndex.get(index) ?? 0) + 1);
    }
    const fresh = !countedBuffers.has(cel.buffer_id);
    countedBuffers.add(cel.buffer_id);
    for (const [index, pixels] of perIndex) {
      if (fresh) add(index, pixels);
      const seenFrames = framesByIndex.get(index) ?? new Set<number>();
      seenFrames.add(cel.frame_id);
      framesByIndex.set(index, seenFrames);
    }
  }

  const tiles = await rows<{ data: Buffer }>(
    client,
    `SELECT t.data FROM tiles t JOIN tilesets ts ON ts.id = t.tileset_id WHERE ts.sprite_id = $1`,
    [sprite.id],
  );
  for (const tile of tiles) {
    const perIndex = new Map<number, number>();
    for (const index of tile.data) {
      if (index === 0) continue;
      perIndex.set(index, (perIndex.get(index) ?? 0) + 1);
    }
    for (const [index, pixels] of perIndex) add(index, pixels);
  }

  for (const [index, entry] of usage) {
    entry.frames = framesByIndex.get(index)?.size ?? 0;
  }
  return usage;
}

export async function tileUses(client: PoolClient, tilesetId: number): Promise<Map<number, number>> {
  const list = await rows<{ tile: number; uses: string }>(
    client,
    `SELECT c.tile, COUNT(*)::text AS uses
       FROM tilemap_cells c JOIN tilemaps m ON m.id = c.tilemap_id
      WHERE m.tileset_id = $1 AND c.tile <> 0
      GROUP BY c.tile`,
    [tilesetId],
  );
  return new Map(list.map((row) => [row.tile, Number(row.uses)]));
}

export function tileRows(data: Buffer, size: number, flipH = false, flipV = false): number[][] {
  const out: number[][] = [];
  for (let y = 0; y < size; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < size; x += 1) row.push(data[y * size + x] ?? 0);
    out.push(row);
  }
  return flipTileRows(out, flipH, flipV);
}

export function tileBuffer(tiles: number[][]): Buffer {
  const size = tiles.length;
  const out = Buffer.alloc(size * size);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) out[y * size + x] = tiles[y][x];
  return out;
}
