import { q, one } from './db.js';
import { getSprite, getLayers, getFrames, celRows, blankRows } from './sprites.js';
import { composite, makeColorOf } from '../shared/rules.js';
import { sha256Hex } from './config.js';

export interface PaletteSwatch { index: number; color: string; version: number; edited_by: number | null }

export async function paletteSwatches(paletteId: number): Promise<PaletteSwatch[]> {
  return q<PaletteSwatch>(
    'select index, color, version, edited_by from swatches where palette_id = $1 order by index asc',
    [paletteId]
  );
}

interface Count { usedBy: number; framesBy: Set<number> }

/** True pixel counts for every swatch: cel cells across frames and layers with a
 * linked cel counted once, plus tile cells with each tile counted once. */
export async function swatchCounts(spriteId: number): Promise<Map<number, Count>> {
  const frames = await getFrames(spriteId);
  const layers = await getLayers(spriteId);
  const counts = new Map<number, Count>();
  const entry = (idx: number): Count => {
    let c = counts.get(idx);
    if (!c) { c = { usedBy: 0, framesBy: new Set() }; counts.set(idx, c); }
    return c;
  };
  const countedGroups = new Set<string>();
  for (const frame of frames) {
    for (const layer of layers) {
      const rows = await celRows(Number(frame.id), Number(layer.id));
      if (!rows) continue;
      const link = await one<{ link_frame_id: string | null }>(
        'select link_frame_id::text from cels where frame_id = $1 and layer_id = $2',
        [frame.id, layer.id]
      );
      const groupKey = link?.link_frame_id ? `link:${link.link_frame_id}:${layer.id}` : `${frame.id}:${layer.id}`;
      const fresh = !countedGroups.has(groupKey);
      countedGroups.add(groupKey);
      for (const row of rows) {
        for (const idx of row) {
          if (idx === 0) continue;
          const c = entry(idx);
          c.framesBy.add(frame.position);
          if (fresh) c.usedBy++;
        }
      }
    }
  }
  const tiles = await q<{ rows: number[][] }>(
    'select t.rows from tiles t join tilesets ts on ts.id = t.tileset_id where ts.sprite_id = $1',
    [spriteId]
  );
  for (const t of tiles) for (const row of t.rows) for (const idx of row) {
    if (idx === 0) continue;
    entry(idx).usedBy++;
  }
  return counts;
}

/** Composite RGBA bytes for one frame, hidden layers excluded. */
export async function frameComposite(spriteId: number, framePos: number): Promise<{ buf: Uint8Array; w: number; h: number }> {
  const sprite = await getSprite(spriteId);
  const layers = await getLayers(spriteId);
  const frames = await getFrames(spriteId);
  const frame = frames.find((f) => f.position === framePos);
  if (!frame) throw new Error('frame missing');
  const swatches = await paletteSwatches(Number(sprite.palette_id));
  const colorOf = makeColorOf(swatches.map((s) => ({ index: s.index, color: s.color })));
  const stack: { rows: number[][]; colorOf: (i: number) => string; opacity: number; blend: 'normal' | 'multiply'; visible: boolean }[] = [];
  for (const layer of layers) {
    const rows = await celRows(Number(frame.id), Number(layer.id));
    stack.push({
      rows: rows ?? blankRows(sprite.width, sprite.height),
      colorOf,
      opacity: layer.opacity,
      blend: layer.blend === 'multiply' ? 'multiply' : 'normal',
      visible: layer.visible
    });
  }
  return { buf: composite(sprite.width, sprite.height, stack), w: sprite.width, h: sprite.height };
}

export async function frameCompositeHash(spriteId: number, framePos: number): Promise<string> {
  const { buf } = await frameComposite(spriteId, framePos);
  return sha256Hex(buf);
}
