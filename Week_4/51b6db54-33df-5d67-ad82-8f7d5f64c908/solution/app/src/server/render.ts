import { GifWriter } from 'omggif';
import { PNG } from 'pngjs';
import { frameRgba, type SpriteModel } from './model';
import { rh } from '../shared/rules';

export class TooManyColours extends Error {}

export const slugOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function scaleRgba(rgba: Uint8Array, width: number, height: number, scale: number): Uint8Array {
  if (scale === 1) return rgba;
  const out = new Uint8Array(width * scale * height * scale * 4);
  for (let y = 0; y < height * scale; y++) {
    for (let x = 0; x < width * scale; x++) {
      const from = (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4;
      out.set(rgba.subarray(from, from + 4), (y * width * scale + x) * 4);
    }
  }
  return out;
}

export function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba);
  return PNG.sync.write(png, { colorType: 6, deflateLevel: 6 });
}

/** A GIF: a delay of max(2, rh(ms, 10)) centiseconds per frame, alpha below 128 transparent, each frame disposed to background. */
export function encodeGif(frames: readonly { rgba: Uint8Array; ms: number }[], width: number, height: number): Buffer {
  const out = Buffer.alloc(width * height * frames.length * 2 + frames.length * 1100 + 4096);
  const writer = new GifWriter(out, width, height, { loop: 0 });
  for (const frame of frames) {
    const palette: number[] = [0];
    const lookup = new Map<number, number>();
    const pixels = new Uint8Array(width * height);
    for (let p = 0; p < width * height; p++) {
      const at = p * 4;
      if ((frame.rgba[at + 3] ?? 0) < 128) continue;
      const rgb = ((frame.rgba[at] ?? 0) << 16) | ((frame.rgba[at + 1] ?? 0) << 8) | (frame.rgba[at + 2] ?? 0);
      let index = lookup.get(rgb);
      if (index === undefined) {
        if (palette.length > 255) throw new TooManyColours('more than 255 opaque colours');
        index = palette.length;
        palette.push(rgb);
        lookup.set(rgb, index);
      }
      pixels[p] = index;
    }
    let size = 2;
    while (size < palette.length) size *= 2;
    while (palette.length < size) palette.push(0);
    writer.addFrame(0, 0, width, height, pixels, { palette, delay: Math.max(2, rh(frame.ms, 10)), disposal: 2, transparent: 0 });
  }
  return Buffer.from(out.subarray(0, writer.end()));
}

export interface SheetFiles {
  png: Buffer;
  json: Buffer;
}

/** The packed sheet and its JSON: frames left to right, top to bottom, with padding between and extruded edges. */
export function renderSheet(model: SpriteModel, composites: readonly Uint8Array[], scale: number, padding: number, extrude: number): SheetFiles {
  const frameW = model.width * scale;
  const frameH = model.height * scale;
  const count = composites.length;
  const columns = Math.ceil(Math.sqrt(count));
  const rowCount = Math.ceil(count / columns);
  const cellW = frameW + 2 * extrude;
  const cellH = frameH + 2 * extrude;
  const width = columns * cellW + (columns - 1) * padding;
  const height = rowCount * cellH + (rowCount - 1) * padding;
  const sheet = new Uint8Array(width * height * 4);
  const origins: { x: number; y: number }[] = [];
  composites.forEach((rgba, i) => {
    const scaled = scaleRgba(rgba, model.width, model.height, scale);
    const left = (i % columns) * (cellW + padding);
    const top = Math.floor(i / columns) * (cellH + padding);
    origins.push({ x: left + extrude, y: top + extrude });
    for (let y = 0; y < cellH; y++) {
      for (let x = 0; x < cellW; x++) {
        const sx = Math.min(frameW - 1, Math.max(0, x - extrude));
        const sy = Math.min(frameH - 1, Math.max(0, y - extrude));
        sheet.set(scaled.subarray((sy * frameW + sx) * 4, (sy * frameW + sx) * 4 + 4), ((top + y) * width + left + x) * 4);
      }
    }
  });
  const json = {
    meta: { sprite: model.name, scale, size: { w: width, h: height }, padding, extrude },
    frames: model.frames.map((frame, i) => ({ index: i + 1, x: origins[i]?.x ?? 0, y: origins[i]?.y ?? 0, w: frameW, h: frameH, duration_ms: frame.duration_ms })),
    tags: model.tags.map((t) => ({ name: t.name, from: t.from_frame, to: t.to_frame, direction: t.direction })),
  };
  return { png: encodePng(sheet, width, height), json: Buffer.from(JSON.stringify(json)) };
}

export const compositesOf = (model: SpriteModel): Uint8Array[] => model.frames.map((frame) => frameRgba(model, frame.id));
