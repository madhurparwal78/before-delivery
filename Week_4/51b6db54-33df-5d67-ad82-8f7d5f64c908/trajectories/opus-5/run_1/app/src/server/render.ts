import { PNG } from 'pngjs';
import gifenc from 'gifenc';
import { rh } from '../shared/composite.js';
import { sheetLayout, type SheetLayout } from '../shared/sheet.js';
import type { TagDirection } from '../shared/types.js';

export interface FrameBytes {
  width: number;
  height: number;
  rgba: Uint8Array;
  duration_ms: number;
}

export function scaleFrame(frame: FrameBytes, scale: number): FrameBytes {
  const width = frame.width * scale;
  const height = frame.height * scale;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.floor(y / scale);
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.floor(x / scale);
      const from = (sourceY * frame.width + sourceX) * 4;
      const to = (y * width + x) * 4;
      rgba[to] = frame.rgba[from];
      rgba[to + 1] = frame.rgba[from + 1];
      rgba[to + 2] = frame.rgba[from + 2];
      rgba[to + 3] = frame.rgba[from + 3];
    }
  }
  return { width, height, rgba, duration_ms: frame.duration_ms };
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba);
  return PNG.sync.write(png, { colorType: 6, inputHasAlpha: true });
}

export function decodePng(bytes: Buffer): FrameBytes[] {
  const png = PNG.sync.read(bytes);
  return [
    {
      width: png.width,
      height: png.height,
      rgba: new Uint8Array(png.data),
      duration_ms: 100,
    },
  ];
}

/** GIF delay in centiseconds, never under two. */
export function gifDelay(durationMs: number): number {
  return Math.max(2, rh(durationMs, 10));
}

export class GifTooManyColours extends Error {}

/** Every frame in order, alpha below 128 transparent, looping forever. */
export function encodeGif(frames: FrameBytes[]): Buffer {
  const encoder = gifenc.GIFEncoder();
  for (const frame of frames) {
    const palette: number[][] = [[0, 0, 0, 0]];
    const lookup = new Map<string, number>();
    const indices = new Uint8Array(frame.width * frame.height);
    for (let cell = 0; cell < indices.length; cell += 1) {
      const at = cell * 4;
      if (frame.rgba[at + 3] < 128) {
        indices[cell] = 0;
        continue;
      }
      const key = `${frame.rgba[at]},${frame.rgba[at + 1]},${frame.rgba[at + 2]}`;
      let index = lookup.get(key);
      if (index === undefined) {
        if (palette.length > 255) throw new GifTooManyColours('more than 255 opaque colours');
        palette.push([frame.rgba[at], frame.rgba[at + 1], frame.rgba[at + 2], 255]);
        index = palette.length - 1;
        lookup.set(key, index);
      }
      indices[cell] = index;
    }
    let size = 2;
    while (size < palette.length) size *= 2;
    const padded = [...palette];
    while (padded.length < size) padded.push([0, 0, 0, 0]);
    encoder.writeFrame(indices, frame.width, frame.height, {
      palette: padded,
      transparent: true,
      transparentIndex: 0,
      delay: gifDelay(frame.duration_ms) * 10,
      dispose: 2,
      repeat: 0,
    });
  }
  encoder.finish();
  return Buffer.from(encoder.bytes());
}

export interface SheetResult {
  png: Buffer;
  json: Buffer;
  layout: SheetLayout;
}

/** The packed sheet and its JSON, byte-identical for one sequence number. */
export function encodeSheet(
  spriteName: string,
  frames: FrameBytes[],
  tags: { name: string; from: number; to: number; direction: TagDirection }[],
  settings: { scale: number; padding: number; extrude: number },
): SheetResult {
  const scaled = frames.map((frame) => scaleFrame(frame, settings.scale));
  const frameWidth = frames[0]?.width ?? 1;
  const frameHeight = frames[0]?.height ?? 1;
  const layout = sheetLayout(
    frames.length,
    frameWidth,
    frameHeight,
    settings.scale,
    settings.padding,
    settings.extrude,
    frames.map((frame) => frame.duration_ms),
  );
  const rgba = new Uint8Array(layout.width * layout.height * 4);
  const put = (x: number, y: number, from: Uint8Array, at: number): void => {
    if (x < 0 || y < 0 || x >= layout.width || y >= layout.height) return;
    const to = (y * layout.width + x) * 4;
    rgba[to] = from[at];
    rgba[to + 1] = from[at + 1];
    rgba[to + 2] = from[at + 2];
    rgba[to + 3] = from[at + 3];
  };
  layout.frames.forEach((place, at) => {
    const frame = scaled[at];
    for (let y = -settings.extrude; y < frame.height + settings.extrude; y += 1) {
      for (let x = -settings.extrude; x < frame.width + settings.extrude; x += 1) {
        const sourceX = Math.min(Math.max(x, 0), frame.width - 1);
        const sourceY = Math.min(Math.max(y, 0), frame.height - 1);
        put(place.x + x, place.y + y, frame.rgba, (sourceY * frame.width + sourceX) * 4);
      }
    }
  });
  const json = {
    meta: {
      sprite: spriteName,
      scale: settings.scale,
      size: { w: layout.width, h: layout.height },
      padding: settings.padding,
      extrude: settings.extrude,
    },
    frames: layout.frames.map((frame) => ({
      index: frame.index,
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: frame.h,
      duration_ms: frame.duration_ms,
    })),
    tags: tags.map((tag) => ({
      name: tag.name,
      from: tag.from,
      to: tag.to,
      direction: tag.direction,
    })),
  };
  return {
    png: encodePng(layout.width, layout.height, rgba),
    json: Buffer.from(JSON.stringify(json), 'utf8'),
    layout,
  };
}
