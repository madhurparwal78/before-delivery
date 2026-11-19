import { formatColour, parseColour, type Rgba } from './colour.js';
import { sha256Hex } from './sha256.js';
import type { Blend, Surface } from './types.js';

/** Rounding half up for non-negative integers. */
export function rh(n: number, d: number): number {
  return Math.floor((2 * n + d) / (2 * d));
}

export interface CompositeLayer {
  surface: Surface;
  opacity: number;
  blend: Blend;
  visible: boolean;
}

/** One layer's swatch colour laid over the current destination colour. */
export function overlay(source: Rgba, opacity: number, blend: Blend, dest: Rgba): Rgba {
  const a = rh(source[3] * opacity, 100);
  if (a === 0) return dest;
  const da = dest[3];
  const c: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const s = source[i];
    c[i] =
      blend === 'multiply' && da > 0
        ? rh(s * (255 - da) + rh(s * dest[i], 255) * da, 255)
        : s;
  }
  const ra = a + rh(da * (255 - a), 255);
  const out: Rgba = [0, 0, 0, ra];
  for (let i = 0; i < 3; i += 1) {
    out[i] = rh(c[i] * a * 255 + dest[i] * da * (255 - a), ra * 255);
  }
  return out;
}

/**
 * The composite of one frame: layers bottom first, hidden layers excluded.
 * `colours` maps swatch index to colour text; index 0 is always transparent.
 */
export function compositeFrame(
  layers: CompositeLayer[],
  colours: Map<number, string>,
  width: number,
  height: number,
  options: { ignoreVisibility?: boolean } = {},
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const cache = new Map<number, Rgba>();
  const colourOf = (index: number): Rgba => {
    const hit = cache.get(index);
    if (hit) return hit;
    const text = index === 0 ? '00000000' : colours.get(index) ?? '00000000';
    const rgba = parseColour(text);
    cache.set(index, rgba);
    return rgba;
  };

  const used = layers.filter((layer) => options.ignoreVisibility || layer.visible);
  for (let cell = 0; cell < width * height; cell += 1) {
    let dest: Rgba = [0, 0, 0, 0];
    for (const layer of used) {
      const index = layer.surface.indices[cell];
      if (index === 0) continue;
      dest = overlay(colourOf(index), layer.opacity, layer.blend, dest);
    }
    out[cell * 4] = dest[0];
    out[cell * 4 + 1] = dest[1];
    out[cell * 4 + 2] = dest[2];
    out[cell * 4 + 3] = dest[3];
  }
  return out;
}

export function compositeHash(bytes: Uint8Array): string {
  return sha256Hex(bytes);
}

export function bytesToColourRows(bytes: Uint8Array, width: number, height: number): string[][] {
  const rows: string[][] = [];
  for (let y = 0; y < height; y += 1) {
    const row: string[] = [];
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      row.push(formatColour([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]));
    }
    rows.push(row);
  }
  return rows;
}
