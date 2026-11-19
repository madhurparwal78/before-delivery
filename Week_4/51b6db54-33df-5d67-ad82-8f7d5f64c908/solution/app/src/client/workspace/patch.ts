import { reducedMotion } from '../ui';
import type { Patch, SpriteEvent } from '../../shared/types';
import { startFlood } from './flood';
import type { Model } from './model';
import { teamStroke } from './team';
import { notify } from '../ui';

const decode = (data: string): Uint8Array => Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));

/** Applies one sequenced event to the document. Returns true when the workspace must be reloaded instead. */
export function applyEvent(m: Model, event: SpriteEvent): boolean {
  const patch = event.data;
  m.pending = m.pending.filter((p) => p.csid !== patch.csid);
  if (patch.notice) notify(patch.notice.kind === 'merged' ? `Merged into ${patch.notice.layer}, ${m.plural(patch.notice.count, 'new swatch', 'new swatches')}` : `Restored ${patch.notice.name}`);
  if (patch.refresh) {
    m.seq = event.seq;
    return true;
  }
  const flood = patch.flood;
  const before = flood ? m.swatch(flood.index)?.color : undefined;
  const fromCount = flood ? (m.counts.pixels[flood.index] ?? 0) : 0;
  const changedFrames = new Set<number>();
  let everything = false;
  for (const buffer of patch.buffers ?? []) {
    m.buffers.set(buffer.id, buffer.data ? decode(buffer.data) : new Uint8Array(m.width * m.height));
  }
  for (const cel of patch.cels ?? []) {
    m.cels.set(`${cel.frame}:${cel.layer}`, cel.buffer);
    changedFrames.add(cel.frame);
  }
  for (const [buffer, at, value] of patch.cells ?? []) {
    const cel = m.buffers.get(buffer);
    if (cel) cel[at] = value;
    m.framesUsing(buffer).forEach((id) => changedFrames.add(id));
  }
  if (patch.layers) {
    m.setLayers(patch.layers);
    everything = true;
  }
  if (patch.frames) {
    m.frames = patch.frames;
    if (!m.frames.some((f) => f.id === m.frameId)) m.frameId = m.frames[0]?.id ?? 0;
  }
  if (patch.tags) m.tags = patch.tags;
  applySwatches(m, patch);
  if (patch.swatches || patch.order) everything = true;
  if (patch.counts) m.counts = patch.counts;
  applyTiles(m, patch);
  if (patch.comment) {
    const at = m.comments.findIndex((c) => c.id === patch.comment?.id);
    if (at >= 0) m.comments[at] = patch.comment;
    else m.comments.push(patch.comment);
  }
  if (patch.snapshot && !m.snapshots.some((s) => s.id === patch.snapshot?.id)) m.snapshots = [patch.snapshot, ...m.snapshots];
  m.seq = event.seq;
  if (everything) m.touchDocument();
  else m.touchDocument(changedFrames);
  if (patch.actor !== undefined && patch.actor !== m.me.id) {
    const entry = m.presence.find((p) => p.id === patch.actor);
    if (entry) entry.lastActive = m.businessNow();
    if ((event.type === 'stroke' || event.type === 'selection') && patch.cells) teamStroke(m, event.by, patch.cells.length);
  }
  if (flood && before !== undefined) {
    m.announcement = `Swatch ${flood.index} now ${flood.color}, used by ${m.plural(flood.used_by, 'pixel')} in ${m.plural(flood.frames, 'frame')}`;
    startFlood(m, { index: flood.index, oldColor: before, newColor: flood.color, cursor: [flood.cursor[0], flood.cursor[1]], seq: event.seq, fromCount }, reducedMotion());
  }
  return false;
}

function applySwatches(m: Model, patch: Patch): void {
  for (const swatch of patch.swatches ?? []) {
    const at = m.swatches.findIndex((s) => s.index === swatch.index);
    if (swatch.removed) {
      if (at >= 0) m.swatches.splice(at, 1);
      if (m.primary === swatch.index) m.primary = m.swatches[0]?.index ?? 0;
      if (m.secondary === swatch.index) m.secondary = 0;
    } else if (at >= 0) m.swatches[at] = swatch;
    else m.swatches.push(swatch);
  }
  if (patch.order) m.order = patch.order;
  if (patch.swatches) m.swatches = [...m.swatches];
}

function applyTiles(m: Model, patch: Patch): void {
  for (const set of patch.tilesets ?? []) {
    const at = m.tilesets.findIndex((t) => t.id === set.id);
    if (at >= 0) m.tilesets[at] = { ...set, tiles: m.tilesets[at]?.tiles ?? [] };
    else {
      m.tilesets.push({ ...set, tiles: [] });
      if (m.tilesetId === 0) m.tilesetId = set.id;
    }
  }
  for (const tile of patch.tiles ?? []) {
    const set = m.tilesets.find((t) => t.id === tile.tileset);
    if (set) set.tiles[tile.number - 1] = tile.rows;
  }
  for (const map of patch.tilemaps ?? []) {
    if (!m.tilemaps.some((t) => t.id === map.id)) {
      m.tilemaps.push({ ...map, cells: [] });
      if (m.tilemapId === 0) m.tilemapId = map.id;
    }
  }
  for (const { map: mapId, cells } of patch.mapCells ?? []) {
    const map = m.tilemaps.find((t) => t.id === mapId);
    if (!map) continue;
    for (const cell of cells) {
      const rest = map.cells.filter((c) => c.x !== cell.x || c.y !== cell.y);
      map.cells = cell.tile === 0 ? rest : [...rest, cell];
    }
  }
  if (patch.tiles || patch.mapCells || patch.tilesets || patch.tilemaps) m.tilesets = [...m.tilesets];
}
