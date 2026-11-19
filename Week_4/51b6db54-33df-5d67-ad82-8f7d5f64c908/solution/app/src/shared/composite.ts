import { colourText, parseColour, type Rgba } from './colour';
import { sha256Hex } from './sha256';
import { rh, type Blend } from './rules';

export interface CompositeLayer {
  opacity: number;
  blend: Blend;
  visible: boolean;
  /** Swatch indices of the layer's cel for the frame; null when the frame has no cel. */
  cel: Uint8Array | null;
}

/** Swatch index -> colour; index 0 and removed swatches are transparent. */
export type ColourTable = ReadonlyMap<number, Rgba>;

const CLEAR: Rgba = [0, 0, 0, 0];

/** Composites layers (bottom first) into RGBA bytes with the published integer formulas. */
export function compositeFrame(width: number, height: number, layers: readonly CompositeLayer[], colours: ColourTable): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const drawn = layers.filter((layer) => layer.visible && layer.cel !== null);
  for (let p = 0; p < width * height; p++) {
    let dr = 0;
    let dg = 0;
    let db = 0;
    let da = 0;
    for (const layer of drawn) {
      const [sr, sg, sb, sa] = colours.get(layer.cel?.[p] ?? 0) ?? CLEAR;
      const a = rh(sa * layer.opacity, 100);
      if (a === 0) continue;
      const mix = (s: number, d: number): number => (layer.blend === 'multiply' && da > 0 ? rh(s * (255 - da) + rh(s * d, 255) * da, 255) : s);
      const ra = a + rh(da * (255 - a), 255);
      const blendOne = (s: number, d: number): number => rh(mix(s, d) * a * 255 + d * da * (255 - a), ra * 255);
      [dr, dg, db, da] = [blendOne(sr, dr), blendOne(sg, dg), blendOne(sb, db), ra];
    }
    out.set([dr, dg, db, da], p * 4);
  }
  return out;
}

export const compositeHash = (rgba: Uint8Array): string => sha256Hex(rgba);

/** Rows of `rrggbbaa` text, as the pixel route returns them. */
export function colourRows(rgba: Uint8Array, width: number, height: number): string[][] {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      const at = (y * width + x) * 4;
      return colourText(rgba[at] ?? 0, rgba[at + 1] ?? 0, rgba[at + 2] ?? 0, rgba[at + 3] ?? 0);
    }),
  );
}

export function colourTable(swatches: readonly { index: number; color: string }[]): Map<number, Rgba> {
  return new Map(swatches.map((swatch) => [swatch.index, parseColour(swatch.color)]));
}
