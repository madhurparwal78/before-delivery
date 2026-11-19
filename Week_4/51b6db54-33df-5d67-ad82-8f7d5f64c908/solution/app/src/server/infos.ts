import { userNames } from './auth';
import type { Queryable } from './db';
import { loadFrames, loadLayers, loadSwatches, loadTags, type SwatchRow, type TilemapModel, type TilesetModel } from './model';
import type { FrameInfo, LayerInfo, SwatchInfo, TilemapInfo, TilesetInfo } from '../shared/types';
import type { Tag } from '../shared/timeline';

export async function layerInfos(q: Queryable, spriteId: number): Promise<LayerInfo[]> {
  const layers = await loadLayers(q, spriteId);
  const names = await userNames(layers.flatMap((l) => (l.locked_by === null ? [] : [l.locked_by])));
  return layers.map((l) => ({ ...l, locked_by: l.locked_by === null ? null : (names.get(l.locked_by) ?? '') }));
}

export async function frameInfos(q: Queryable, spriteId: number): Promise<FrameInfo[]> {
  return (await loadFrames(q, spriteId)).map(({ id, duration_ms }) => ({ id, duration_ms }));
}

export async function swatchInfosOf(q: Queryable, paletteId: number): Promise<SwatchInfo[]> {
  return swatchInfos(await loadSwatches(q, paletteId));
}

export async function swatchInfos(swatches: SwatchRow[]): Promise<SwatchInfo[]> {
  const names = await userNames(swatches.flatMap((s) => (s.edited_by === null ? [] : [s.edited_by])));
  return swatches
    .filter((s) => !s.removed)
    .map((s) => ({ index: s.idx, color: s.color, version: s.version, edited_by: s.edited_by === null ? null : (names.get(s.edited_by) ?? '') }));
}

export async function tagInfos(q: Queryable, spriteId: number): Promise<Tag[]> {
  return (await loadTags(q, spriteId)).map((t) => ({ id: t.id, name: t.name, from: t.from_frame, to: t.to_frame, direction: t.direction, repeat: t.repeat }));
}

export const tileRows = (tile: Uint8Array, size: number): number[][] => Array.from({ length: size }, (_, y) => Array.from(tile.subarray(y * size, (y + 1) * size)));

export const tilesetInfo = (set: TilesetModel): TilesetInfo => ({
  id: set.id,
  name: set.name,
  tile_size: set.tile_size,
  edge_table: set.edge_table,
  tiles: set.tiles.map((tile) => tileRows(tile, set.tile_size)),
});

export const tilemapInfo = (map: TilemapModel): TilemapInfo => ({
  id: map.id,
  tileset: map.tileset_id,
  name: map.name,
  width: map.width,
  height: map.height,
  cells: map.cells,
});
