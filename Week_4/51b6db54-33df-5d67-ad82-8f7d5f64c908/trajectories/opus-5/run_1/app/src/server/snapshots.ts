import type { PoolClient } from 'pg';
import { compositeFrame, type CompositeLayer } from '../shared/composite.js';
import { formatColour, parseColour } from '../shared/colour.js';
import type { Blend } from '../shared/types.js';
import { first, rows } from './db.js';
import type { SpriteRow } from './access.js';
import { emptySurface, surfaceOf } from './sprite.js';

export interface SnapshotPayload {
  width: number;
  height: number;
  palette: {
    order: number[];
    swatches: { index: number; color: string; version: number; present: boolean }[];
  };
  layers: { name: string; opacity: number; blend: Blend; visible: boolean; position: number }[];
  frames: { number: number; duration_ms: number }[];
  buffers: Record<string, string>;
  cels: { frame: number; layer: string; buffer: string }[];
  tags: { name: string; from: number; to: number; direction: string; repeat: number }[];
  tilesets: {
    name: string;
    tile_size: number;
    edge_table: number[];
    tiles: { number: number; data: string }[];
  }[];
  tilemaps: {
    name: string;
    tileset: number;
    width: number;
    height: number;
    cells: { x: number; y: number; tile: number; flip_h: boolean; flip_v: boolean }[];
  }[];
}

/** The whole sprite at one sequence number; comments are not part of it. */
export async function captureSnapshot(
  client: PoolClient,
  sprite: SpriteRow,
): Promise<SnapshotPayload> {
  const swatches = await rows<{ index: number; color: string; version: number; present: boolean }>(
    client,
    'SELECT index, color, version, present FROM swatches WHERE palette_id = $1 ORDER BY index',
    [sprite.palette_id],
  );
  const order = await first<{ swatch_order: number[] }>(
    client,
    'SELECT swatch_order FROM palettes WHERE id = $1',
    [sprite.palette_id],
  );
  const layers = await rows<{ id: number; name: string; opacity: number; blend: Blend; visible: boolean; position: number }>(
    client,
    'SELECT id, name, opacity, blend, visible, position FROM layers WHERE sprite_id = $1 ORDER BY position',
    [sprite.id],
  );
  const frames = await rows<{ id: number; number: number; duration_ms: number }>(
    client,
    'SELECT id, number, duration_ms FROM frames WHERE sprite_id = $1 ORDER BY number',
    [sprite.id],
  );
  const cels = await rows<{ frame_id: number; layer_id: number; buffer_id: number; data: Buffer }>(
    client,
    `SELECT c.frame_id, c.layer_id, c.buffer_id, b.data
       FROM cels c JOIN buffers b ON b.id = c.buffer_id JOIN frames f ON f.id = c.frame_id
      WHERE f.sprite_id = $1`,
    [sprite.id],
  );
  const tags = await rows<{ name: string; from_frame: number; to_frame: number; direction: string; repeat: number }>(
    client,
    'SELECT name, from_frame, to_frame, direction, repeat FROM tags WHERE sprite_id = $1 ORDER BY id',
    [sprite.id],
  );
  const tilesets = await rows<{ id: number; name: string; tile_size: number; edge_table: number[] }>(
    client,
    'SELECT id, name, tile_size, edge_table FROM tilesets WHERE sprite_id = $1 ORDER BY id',
    [sprite.id],
  );
  const tilemaps = await rows<{ id: number; tileset_id: number; name: string; width: number; height: number }>(
    client,
    'SELECT id, tileset_id, name, width, height FROM tilemaps WHERE sprite_id = $1 ORDER BY id',
    [sprite.id],
  );

  const layerName = new Map(layers.map((layer) => [layer.id, layer.name]));
  const frameNumber = new Map(frames.map((frame) => [frame.id, frame.number]));
  const buffers: Record<string, string> = {};
  for (const cel of cels) buffers[String(cel.buffer_id)] = cel.data.toString('base64');

  const payload: SnapshotPayload = {
    width: sprite.width,
    height: sprite.height,
    palette: { order: order?.swatch_order ?? [], swatches },
    layers: layers.map((layer) => ({
      name: layer.name,
      opacity: layer.opacity,
      blend: layer.blend,
      visible: layer.visible,
      position: layer.position,
    })),
    frames: frames.map((frame) => ({ number: frame.number, duration_ms: frame.duration_ms })),
    buffers,
    cels: cels.map((cel) => ({
      frame: frameNumber.get(cel.frame_id) ?? 1,
      layer: layerName.get(cel.layer_id) ?? '',
      buffer: String(cel.buffer_id),
    })),
    tags: tags.map((tag) => ({
      name: tag.name,
      from: tag.from_frame,
      to: tag.to_frame,
      direction: tag.direction,
      repeat: tag.repeat,
    })),
    tilesets: [],
    tilemaps: [],
  };

  for (const tileset of tilesets) {
    const tiles = await rows<{ number: number; data: Buffer }>(
      client,
      'SELECT number, data FROM tiles WHERE tileset_id = $1 ORDER BY number',
      [tileset.id],
    );
    payload.tilesets.push({
      name: tileset.name,
      tile_size: tileset.tile_size,
      edge_table: tileset.edge_table,
      tiles: tiles.map((tile) => ({ number: tile.number, data: tile.data.toString('base64') })),
    });
  }
  const tilesetAt = new Map(tilesets.map((tileset, at) => [tileset.id, at]));
  for (const tilemap of tilemaps) {
    const cellRows = await rows<{ x: number; y: number; tile: number; flip_h: boolean; flip_v: boolean }>(
      client,
      'SELECT x, y, tile, flip_h, flip_v FROM tilemap_cells WHERE tilemap_id = $1 ORDER BY y, x',
      [tilemap.id],
    );
    payload.tilemaps.push({
      name: tilemap.name,
      tileset: tilesetAt.get(tilemap.tileset_id) ?? 0,
      width: tilemap.width,
      height: tilemap.height,
      cells: cellRows,
    });
  }
  return payload;
}

/** Puts the sprite back byte for byte, keeping every snapshot and comment. */
export async function restoreSnapshot(
  client: PoolClient,
  sprite: SpriteRow,
  payload: SnapshotPayload,
): Promise<void> {
  await client.query('DELETE FROM tilemaps WHERE sprite_id = $1', [sprite.id]);
  await client.query('DELETE FROM tilesets WHERE sprite_id = $1', [sprite.id]);
  await client.query('DELETE FROM tags WHERE sprite_id = $1', [sprite.id]);
  await client.query('DELETE FROM frames WHERE sprite_id = $1', [sprite.id]);
  await client.query('DELETE FROM layers WHERE sprite_id = $1', [sprite.id]);
  await client.query('DELETE FROM buffers WHERE sprite_id = $1', [sprite.id]);
  await client.query('DELETE FROM swatches WHERE palette_id = $1', [sprite.palette_id]);

  for (const swatch of payload.palette.swatches) {
    await client.query(
      'INSERT INTO swatches (palette_id, index, color, version, present) VALUES ($1, $2, $3, $4, $5)',
      [sprite.palette_id, swatch.index, swatch.color, swatch.version, swatch.present],
    );
  }
  await client.query('UPDATE palettes SET swatch_order = $2 WHERE id = $1', [
    sprite.palette_id,
    payload.palette.order,
  ]);

  const layerId = new Map<string, number>();
  for (const layer of payload.layers) {
    const made = await first<{ id: number }>(
      client,
      `INSERT INTO layers (sprite_id, name, opacity, blend, visible, position)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [sprite.id, layer.name, layer.opacity, layer.blend, layer.visible, layer.position],
    );
    layerId.set(layer.name, (made as { id: number }).id);
  }
  const frameId = new Map<number, number>();
  for (const frame of payload.frames) {
    const made = await first<{ id: number }>(
      client,
      'INSERT INTO frames (sprite_id, number, duration_ms) VALUES ($1, $2, $3) RETURNING id',
      [sprite.id, frame.number, frame.duration_ms],
    );
    frameId.set(frame.number, (made as { id: number }).id);
  }
  const bufferId = new Map<string, number>();
  for (const [key, data] of Object.entries(payload.buffers)) {
    const made = await first<{ id: number }>(
      client,
      'INSERT INTO buffers (sprite_id, data) VALUES ($1, $2) RETURNING id',
      [sprite.id, Buffer.from(data, 'base64')],
    );
    bufferId.set(key, (made as { id: number }).id);
  }
  for (const cel of payload.cels) {
    const frame = frameId.get(cel.frame);
    const layer = layerId.get(cel.layer);
    const buffer = bufferId.get(cel.buffer);
    if (frame === undefined || layer === undefined || buffer === undefined) continue;
    await client.query('INSERT INTO cels (frame_id, layer_id, buffer_id) VALUES ($1, $2, $3)', [
      frame,
      layer,
      buffer,
    ]);
  }
  for (const tag of payload.tags) {
    await client.query(
      'INSERT INTO tags (sprite_id, name, from_frame, to_frame, direction, repeat) VALUES ($1, $2, $3, $4, $5, $6)',
      [sprite.id, tag.name, tag.from, tag.to, tag.direction, tag.repeat],
    );
  }
  const tilesetIds: number[] = [];
  for (const tileset of payload.tilesets) {
    const made = await first<{ id: number }>(
      client,
      'INSERT INTO tilesets (sprite_id, name, tile_size, edge_table) VALUES ($1, $2, $3, $4) RETURNING id',
      [sprite.id, tileset.name, tileset.tile_size, tileset.edge_table],
    );
    const id = (made as { id: number }).id;
    tilesetIds.push(id);
    for (const tile of tileset.tiles) {
      await client.query('INSERT INTO tiles (tileset_id, number, data) VALUES ($1, $2, $3)', [
        id,
        tile.number,
        Buffer.from(tile.data, 'base64'),
      ]);
    }
  }
  for (const tilemap of payload.tilemaps) {
    const made = await first<{ id: number }>(
      client,
      'INSERT INTO tilemaps (sprite_id, tileset_id, name, width, height) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [sprite.id, tilesetIds[tilemap.tileset] ?? tilesetIds[0], tilemap.name, tilemap.width, tilemap.height],
    );
    const id = (made as { id: number }).id;
    for (const cell of tilemap.cells) {
      await client.query(
        'INSERT INTO tilemap_cells (tilemap_id, x, y, tile, flip_h, flip_v) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, cell.x, cell.y, cell.tile, cell.flip_h, cell.flip_v],
      );
    }
  }
  await client.query('UPDATE layers SET locked_by = NULL WHERE sprite_id = $1', [sprite.id]);
}

function compositeOf(payload: SnapshotPayload, frameNumber: number): Uint8Array {
  const colours = new Map<number, string>();
  for (const swatch of payload.palette.swatches) {
    if (swatch.present) colours.set(swatch.index, swatch.color);
  }
  const layers: CompositeLayer[] = [...payload.layers]
    .sort((l, r) => r.position - l.position)
    .map((layer) => {
      const cel = payload.cels.find((entry) => entry.frame === frameNumber && entry.layer === layer.name);
      const data = cel === undefined ? null : payload.buffers[cel.buffer];
      return {
        surface:
          data === null || data === undefined
            ? emptySurface(payload.width, payload.height)
            : surfaceOf(Buffer.from(data, 'base64'), payload.width, payload.height),
        opacity: layer.opacity,
        blend: layer.blend,
        visible: layer.visible,
      };
    });
  return compositeFrame(layers, colours, payload.width, payload.height);
}

/** Every frame of a captured sprite as composite RGBA bytes, in frame order. */
export function payloadFrames(payload: SnapshotPayload): {
  width: number;
  height: number;
  rgba: Uint8Array;
  duration_ms: number;
}[] {
  return [...payload.frames]
    .sort((l, r) => l.number - r.number)
    .map((frame) => ({
      width: payload.width,
      height: payload.height,
      rgba: compositeOf(payload, frame.number),
      duration_ms: frame.duration_ms,
    }));
}

export interface CompareFrame {
  frame: number;
  changed: number;
  cells: { x: number; y: number; before: string; after: string }[];
}

/** Each changed frame's count and changed cells, ordered by y then x. */
export function compareSnapshots(from: SnapshotPayload, to: SnapshotPayload): CompareFrame[] {
  const frameNumbers = new Set<number>();
  for (const frame of from.frames) frameNumbers.add(frame.number);
  for (const frame of to.frames) frameNumbers.add(frame.number);
  const width = Math.max(from.width, to.width);
  const height = Math.max(from.height, to.height);
  const out: CompareFrame[] = [];
  for (const number of [...frameNumbers].sort((l, r) => l - r)) {
    const hasFrom = from.frames.some((frame) => frame.number === number);
    const hasTo = to.frames.some((frame) => frame.number === number);
    const before = hasFrom ? compositeOf(from, number) : new Uint8Array(width * height * 4);
    const after = hasTo ? compositeOf(to, number) : new Uint8Array(width * height * 4);
    const cells: CompareFrame['cells'] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 4;
        const left = formatColour(parseColour(colourAt(before, at)));
        const right = formatColour(parseColour(colourAt(after, at)));
        if (left === right) continue;
        cells.push({ x, y, before: left, after: right });
      }
    }
    if (cells.length > 0) out.push({ frame: number, changed: cells.length, cells });
  }
  return out;
}

function colourAt(bytes: Uint8Array, at: number): string {
  return formatColour([bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0]);
}
