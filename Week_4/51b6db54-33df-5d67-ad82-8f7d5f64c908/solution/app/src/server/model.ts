import { gunzipSync, gzipSync } from 'node:zlib';
import { rows, one, type Queryable } from './db';
import { compositeFrame, colourTable } from '../shared/composite';
import type { Blend, Direction } from '../shared/rules';
import type { Counts } from '../shared/types';

export interface LayerRow {
  id: number;
  name: string;
  opacity: number;
  blend: Blend;
  visible: boolean;
  locked_by: number | null;
  /** 1 is the top layer. */
  position: number;
}

export interface FrameRow {
  id: number;
  position: number;
  duration_ms: number;
}

export interface SwatchRow {
  idx: number;
  color: string;
  version: number;
  edited_by: number | null;
  removed: boolean;
  removed_by: number | null;
}

export interface TagRow {
  id: number;
  name: string;
  from_frame: number;
  to_frame: number;
  direction: Direction;
  repeat: number;
}

export interface TilesetModel {
  id: number;
  name: string;
  tile_size: number;
  edge_table: number[];
  /** Tile number n is tiles[n - 1]; each tile is tile_size * tile_size swatch indices. */
  tiles: Uint8Array[];
}

export interface TilemapModel {
  id: number;
  tileset_id: number;
  name: string;
  width: number;
  height: number;
  cells: { x: number; y: number; tile: number; flip_h: boolean; flip_v: boolean }[];
}

/** The whole state of a sprite, as loaded from Postgres or carried by a snapshot or an export job. */
export interface SpriteModel {
  id: number;
  name: string;
  width: number;
  height: number;
  layers: LayerRow[];
  frames: FrameRow[];
  buffers: Map<number, Uint8Array>;
  cels: Map<string, number>;
  swatches: SwatchRow[];
  order: number[];
  tags: TagRow[];
  tilesets: TilesetModel[];
  tilemaps: TilemapModel[];
}

export const celKey = (frameId: number, layerId: number): string => `${frameId}:${layerId}`;

export interface SpriteRow {
  id: number;
  project_id: number;
  palette_id: number;
  name: string;
  width: number;
  height: number;
  seq: number;
}

export async function loadSpriteRow(q: Queryable, id: number, lock = false): Promise<SpriteRow | undefined> {
  return one<SpriteRow>(q, `SELECT id, project_id, palette_id, name, width, height, seq FROM sprites WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
}

export const loadLayers = (q: Queryable, spriteId: number): Promise<LayerRow[]> =>
  rows<LayerRow>(q, 'SELECT id, name, opacity, blend, visible, locked_by, position FROM layers WHERE sprite_id = $1 ORDER BY position', [spriteId]);

export const loadFrames = (q: Queryable, spriteId: number): Promise<FrameRow[]> =>
  rows<FrameRow>(q, 'SELECT id, position, duration_ms FROM frames WHERE sprite_id = $1 ORDER BY position', [spriteId]);

export const loadSwatches = (q: Queryable, paletteId: number): Promise<SwatchRow[]> =>
  rows<SwatchRow>(q, 'SELECT idx, color, version, edited_by, removed, removed_by FROM swatches WHERE palette_id = $1 ORDER BY idx', [paletteId]);

export const loadTags = (q: Queryable, spriteId: number): Promise<TagRow[]> =>
  rows<TagRow>(q, 'SELECT id, name, from_frame, to_frame, direction, repeat FROM tags WHERE sprite_id = $1 ORDER BY id', [spriteId]);

export async function loadPaletteOrder(q: Queryable, paletteId: number): Promise<number[]> {
  return (await one<{ ord: number[] }>(q, 'SELECT ord FROM palettes WHERE id = $1', [paletteId]))?.ord ?? [];
}

export async function loadTilesets(q: Queryable, spriteId: number): Promise<TilesetModel[]> {
  const sets = await rows<{ id: number; name: string; tile_size: number; edge_table: number[] }>(
    q,
    'SELECT id, name, tile_size, edge_table FROM tilesets WHERE sprite_id = $1 ORDER BY id',
    [spriteId],
  );
  const tiles = await rows<{ tileset_id: number; number: number; data: Buffer }>(
    q,
    'SELECT t.tileset_id, t.number, t.data FROM tiles t JOIN tilesets s ON s.id = t.tileset_id WHERE s.sprite_id = $1 ORDER BY t.tileset_id, t.number',
    [spriteId],
  );
  return sets.map((set) => ({ ...set, tiles: tiles.filter((t) => t.tileset_id === set.id).map((t) => new Uint8Array(t.data)) }));
}

export async function loadTilemaps(q: Queryable, spriteId: number): Promise<TilemapModel[]> {
  const maps = await rows<{ id: number; tileset_id: number; name: string; width: number; height: number }>(
    q,
    'SELECT id, tileset_id, name, width, height FROM tilemaps WHERE sprite_id = $1 ORDER BY id',
    [spriteId],
  );
  const cells = await rows<{ tilemap_id: number; x: number; y: number; tile: number; flip_h: boolean; flip_v: boolean }>(
    q,
    'SELECT c.tilemap_id, c.x, c.y, c.tile, c.flip_h, c.flip_v FROM map_cells c JOIN tilemaps m ON m.id = c.tilemap_id WHERE m.sprite_id = $1 ORDER BY c.tilemap_id, c.y, c.x',
    [spriteId],
  );
  return maps.map((map) => ({
    ...map,
    cells: cells.filter((c) => c.tilemap_id === map.id).map(({ x, y, tile, flip_h, flip_v }) => ({ x, y, tile, flip_h, flip_v })),
  }));
}

export async function loadModel(q: Queryable, sprite: SpriteRow): Promise<SpriteModel> {
  const layers = await loadLayers(q, sprite.id);
  const frames = await loadFrames(q, sprite.id);
  const swatches = await loadSwatches(q, sprite.palette_id);
  const order = await loadPaletteOrder(q, sprite.palette_id);
  const tags = await loadTags(q, sprite.id);
  const tilesets = await loadTilesets(q, sprite.id);
  const tilemaps = await loadTilemaps(q, sprite.id);
  const celRows = await rows<{ frame_id: number; layer_id: number; buffer_id: number }>(
    q,
    'SELECT c.frame_id, c.layer_id, c.buffer_id FROM cels c JOIN frames f ON f.id = c.frame_id WHERE f.sprite_id = $1',
    [sprite.id],
  );
  const bufferRows = await rows<{ id: number; data: Buffer }>(q, 'SELECT id, data FROM buffers WHERE sprite_id = $1', [sprite.id]);
  return {
    id: sprite.id,
    name: sprite.name,
    width: sprite.width,
    height: sprite.height,
    layers,
    frames,
    buffers: new Map(bufferRows.map((b) => [b.id, new Uint8Array(b.data)])),
    cels: new Map(celRows.map((c) => [celKey(c.frame_id, c.layer_id), c.buffer_id])),
    swatches,
    order,
    tags,
    tilesets,
    tilemaps,
  };
}

/** Composite (or one layer's plain colours) of a frame of the model, as RGBA bytes. */
export function frameRgba(model: SpriteModel, frameId: number, onlyLayer?: LayerRow): Uint8Array {
  const colours = colourTable(model.swatches.filter((s) => !s.removed).map((s) => ({ index: s.idx, color: s.color })));
  const stack = (onlyLayer ? [onlyLayer] : [...model.layers].reverse()).map((layer) => ({
    opacity: onlyLayer ? 100 : layer.opacity,
    blend: onlyLayer ? ('normal' as const) : layer.blend,
    visible: onlyLayer ? true : layer.visible,
    cel: model.buffers.get(model.cels.get(celKey(frameId, layer.id)) ?? -1) ?? null,
  }));
  return compositeFrame(model.width, model.height, stack, colours);
}

/** Swatch pixel and frame counts and tile use counts, derived from the artwork every time. */
export async function loadCounts(q: Queryable, spriteId: number): Promise<Counts> {
  const celRows = await rows<{ frame_id: number; buffer_id: number; data: Buffer }>(
    q,
    'SELECT c.frame_id, c.buffer_id, b.data FROM cels c JOIN buffers b ON b.id = c.buffer_id JOIN frames f ON f.id = c.frame_id WHERE f.sprite_id = $1',
    [spriteId],
  );
  const pixels: Record<number, number> = {};
  const counted = new Set<number>();
  const perBuffer = new Map<number, number[]>();
  const seenIn = new Map<number, Set<number>>();
  for (const cel of celRows) {
    let present = perBuffer.get(cel.buffer_id);
    if (!present) {
      present = [...new Set(cel.data)].filter((index) => index !== 0);
      perBuffer.set(cel.buffer_id, present);
    }
    if (!counted.has(cel.buffer_id)) {
      counted.add(cel.buffer_id);
      for (const value of cel.data) if (value !== 0) pixels[value] = (pixels[value] ?? 0) + 1;
    }
    const frameSet = seenIn.get(cel.frame_id) ?? new Set<number>();
    present.forEach((index) => frameSet.add(index));
    seenIn.set(cel.frame_id, frameSet);
  }
  const frames: Record<number, number> = {};
  for (const set of seenIn.values()) for (const index of set) frames[index] = (frames[index] ?? 0) + 1;
  const tiles = await rows<{ data: Buffer }>(
    q,
    'SELECT t.data FROM tiles t JOIN tilesets s ON s.id = t.tileset_id WHERE s.sprite_id = $1',
    [spriteId],
  );
  for (const tile of tiles) for (const value of tile.data) if (value !== 0) pixels[value] = (pixels[value] ?? 0) + 1;
  const useRows = await rows<{ tileset_id: number; tile: number; n: number }>(
    q,
    `SELECT m.tileset_id, c.tile, count(*)::int AS n FROM map_cells c JOIN tilemaps m ON m.id = c.tilemap_id
     WHERE m.sprite_id = $1 AND c.tile > 0 GROUP BY m.tileset_id, c.tile`,
    [spriteId],
  );
  const uses: Record<number, Record<number, number>> = {};
  for (const use of useRows) (uses[use.tileset_id] ??= {})[use.tile] = use.n;
  return { pixels, frames, uses };
}

export interface SnapshotData {
  layers: Omit<LayerRow, 'locked_by'>[];
  frames: FrameRow[];
  buffers: { id: number; data: string }[];
  cels: { frame: number; layer: number; buffer: number }[];
  swatches: { idx: number; color: string; version: number; edited_by: number | null }[];
  order: number[];
  tags: TagRow[];
  tilesets: { id: number; name: string; tile_size: number; edge_table: number[]; tiles: string[] }[];
  tilemaps: { id: number; tileset_id: number; name: string; width: number; height: number; cells: [number, number, number, boolean, boolean][] }[];
}

const b64 = (data: Uint8Array): string => Buffer.from(data).toString('base64');
const fromB64 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'base64'));

export function modelToSnapshot(model: SpriteModel): SnapshotData {
  return {
    layers: model.layers.map(({ locked_by: _released, ...layer }) => layer),
    frames: model.frames,
    buffers: [...model.buffers].map(([id, data]) => ({ id, data: b64(data) })),
    cels: [...model.cels].map(([key, buffer]) => {
      const [frame = 0, layer = 0] = key.split(':').map(Number);
      return { frame, layer, buffer };
    }),
    swatches: model.swatches.filter((s) => !s.removed).map(({ idx, color, version, edited_by }) => ({ idx, color, version, edited_by })),
    order: model.order,
    tags: model.tags,
    tilesets: model.tilesets.map((t) => ({ id: t.id, name: t.name, tile_size: t.tile_size, edge_table: t.edge_table, tiles: t.tiles.map(b64) })),
    tilemaps: model.tilemaps.map((m) => ({
      id: m.id,
      tileset_id: m.tileset_id,
      name: m.name,
      width: m.width,
      height: m.height,
      cells: m.cells.map((c) => [c.x, c.y, c.tile, c.flip_h, c.flip_v]),
    })),
  };
}

/** A model for composites and exports; width and height come from the sprite. */
export function snapshotToModel(data: SnapshotData, size: Pick<SpriteModel, 'id' | 'name' | 'width' | 'height'>): SpriteModel {
  return {
    ...size,
    layers: data.layers.map((layer) => ({ ...layer, locked_by: null })),
    frames: data.frames,
    buffers: new Map(data.buffers.map((b) => [b.id, fromB64(b.data)])),
    cels: new Map(data.cels.map((c) => [celKey(c.frame, c.layer), c.buffer])),
    swatches: data.swatches.map((s) => ({ ...s, removed: false, removed_by: null })),
    order: data.order,
    tags: data.tags,
    tilesets: data.tilesets.map((t) => ({ ...t, tiles: t.tiles.map(fromB64) })),
    tilemaps: data.tilemaps.map((m) => ({
      ...m,
      cells: m.cells.map(([x, y, tile, flip_h, flip_v]) => ({ x, y, tile, flip_h, flip_v })),
    })),
  };
}

export const packSnapshot = (data: SnapshotData): Buffer => gzipSync(Buffer.from(JSON.stringify(data)));
export const unpackSnapshot = (bytes: Buffer): SnapshotData => JSON.parse(gunzipSync(bytes).toString('utf8')) as SnapshotData;
