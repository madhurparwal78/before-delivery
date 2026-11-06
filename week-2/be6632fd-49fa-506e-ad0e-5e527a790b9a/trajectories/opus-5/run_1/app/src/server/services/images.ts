import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { swatchColour } from '../../domain/palette.ts';
import { applyOrientation, readOrientation, type Raster } from './exif.ts';
import { readWebp } from './webp.ts';

export const MAX_SIDE_PIXELS = 12_000;
export const MAX_TOTAL_PIXELS = 40_000_000;

export type LookContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface PreparedImage {
  bytes: Buffer;
  contentType: LookContentType;
  width: number;
  height: number;
}

export type ImageRejection = 'type' | 'pixels';

function withinLimits(width: number, height: number): boolean {
  return (
    width > 0 &&
    height > 0 &&
    width <= MAX_SIDE_PIXELS &&
    height <= MAX_SIDE_PIXELS &&
    width * height <= MAX_TOTAL_PIXELS
  );
}

function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return null;
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] as number;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (offset + 9 > bytes.length) return null;
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    if (marker === 0xda) return null;
    offset += 2 + length;
  }
  return null;
}

/**
 * Judges an upload by decoding its content, turns it upright per its camera orientation and
 * removes all location data and other metadata by writing the image out again.
 */
export function prepareLookImage(input: Buffer): PreparedImage | ImageRejection {
  const png = pngDimensions(input);
  if (png !== null) {
    return withinLimits(png.width, png.height) ? preparePng(input) : 'pixels';
  }
  const jpg = jpegDimensions(input);
  if (jpg !== null) {
    return withinLimits(jpg.width, jpg.height) ? prepareJpeg(input) : 'pixels';
  }
  const webp = readWebp(input);
  if (webp !== null) {
    if (!withinLimits(webp.width, webp.height)) return 'pixels';
    return { bytes: webp.bytes, contentType: 'image/webp', width: webp.width, height: webp.height };
  }
  return 'type';
}

function preparePng(input: Buffer): PreparedImage | ImageRejection {
  let decoded: PNG;
  try {
    decoded = PNG.sync.read(input);
  } catch {
    return 'type';
  }
  const upright = applyOrientation(
    { width: decoded.width, height: decoded.height, data: Buffer.from(decoded.data) },
    readOrientation(input),
  );
  return { ...writePng(upright), contentType: 'image/png' };
}

function prepareJpeg(input: Buffer): PreparedImage | ImageRejection {
  let decoded: { width: number; height: number; data: Uint8Array };
  try {
    decoded = jpeg.decode(input, {
      useTArray: true,
      maxResolutionInMP: MAX_TOTAL_PIXELS / 1_000_000,
      maxMemoryUsageInMB: 512,
    });
  } catch {
    return 'type';
  }
  const upright = applyOrientation(
    { width: decoded.width, height: decoded.height, data: Buffer.from(decoded.data) },
    readOrientation(input),
  );
  const encoded = jpeg.encode(
    { data: upright.data, width: upright.width, height: upright.height },
    88,
  );
  return {
    bytes: Buffer.from(encoded.data),
    contentType: 'image/jpeg',
    width: upright.width,
    height: upright.height,
  };
}

function writePng(raster: Raster): { bytes: Buffer; width: number; height: number } {
  const png = new PNG({ width: raster.width, height: raster.height });
  raster.data.copy(png.data);
  return {
    bytes: PNG.sync.write(png, { deflateLevel: 9 }),
    width: raster.width,
    height: raster.height,
  };
}

// --- The app's own illustrations ------------------------------------------

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseSwatch(name: string): Rgb {
  const hex = swatchColour(name);
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

type Point = readonly [number, number];

class Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 4);
  }

  fill(colour: Rgb): void {
    for (let index = 0; index < this.data.length; index += 4) {
      this.data[index] = colour.r;
      this.data[index + 1] = colour.g;
      this.data[index + 2] = colour.b;
      this.data[index + 3] = 255;
    }
  }

  private plot(x: number, y: number, colour: Rgb): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const at = (y * this.width + x) * 4;
    this.data[at] = colour.r;
    this.data[at + 1] = colour.g;
    this.data[at + 2] = colour.b;
    this.data[at + 3] = 255;
  }

  rect(x: number, y: number, width: number, height: number, colour: Rgb): void {
    for (let row = Math.round(y); row < Math.round(y + height); row += 1) {
      for (let column = Math.round(x); column < Math.round(x + width); column += 1) {
        this.plot(column, row, colour);
      }
    }
  }

  circle(centreX: number, centreY: number, radius: number, colour: Rgb): void {
    const squared = radius * radius;
    for (let row = Math.round(centreY - radius); row <= Math.round(centreY + radius); row += 1) {
      for (let column = Math.round(centreX - radius); column <= Math.round(centreX + radius); column += 1) {
        const dx = column - centreX;
        const dy = row - centreY;
        if (dx * dx + dy * dy <= squared) this.plot(column, row, colour);
      }
    }
  }

  /** Fills a polygon by scanline, used for the garment panels and sleeves. */
  polygon(points: readonly Point[], colour: Rgb): void {
    const ys = points.map(([, y]) => y);
    const top = Math.round(Math.min(...ys));
    const bottom = Math.round(Math.max(...ys));
    for (let row = top; row <= bottom; row += 1) {
      const crossings: number[] = [];
      for (let index = 0; index < points.length; index += 1) {
        const [x1, y1] = points[index] as Point;
        const [x2, y2] = points[(index + 1) % points.length] as Point;
        if (y1 === y2) continue;
        if (row < Math.min(y1, y2) || row >= Math.max(y1, y2)) continue;
        crossings.push(x1 + ((row - y1) / (y2 - y1)) * (x2 - x1));
      }
      crossings.sort((a, b) => a - b);
      for (let index = 0; index + 1 < crossings.length; index += 2) {
        const from = Math.round(crossings[index] as number);
        const to = Math.round(crossings[index + 1] as number);
        for (let column = from; column <= to; column += 1) this.plot(column, row, colour);
      }
    }
  }

  hairlineFrame(inset: number, thickness: number, colour: Rgb): void {
    this.rect(inset, inset, this.width - inset * 2, thickness, colour);
    this.rect(inset, this.height - inset - thickness, this.width - inset * 2, thickness, colour);
    this.rect(inset, inset, thickness, this.height - inset * 2, colour);
    this.rect(this.width - inset - thickness, inset, thickness, this.height - inset * 2, colour);
  }
}

/**
 * A garment illustration drawn from simple shapes in the drop's swatch colours, used for the
 * seeded look images.
 */
export function renderGarmentPng(palette: readonly string[], variant: number): PreparedImage {
  const width = 800;
  const height = 1000;
  const ground = parseSwatch(palette[0] ?? 'stone');
  const accent = parseSwatch(palette[1] ?? 'vermilion');
  const detail = parseSwatch(palette[2] ?? 'sand');
  const ink = parseSwatch('ink');

  const canvas = new Canvas(width, height);
  canvas.fill(ground);
  canvas.hairlineFrame(40, 2, detail);

  const midX = width / 2;
  const shoulder = height * 0.24;
  const hem = height * (variant % 3 === 0 ? 0.78 : 0.68);
  const half = width * (variant % 2 === 0 ? 0.22 : 0.19);

  canvas.polygon(
    [
      [midX - half, shoulder],
      [midX + half, shoulder],
      [midX + half * 1.15, hem],
      [midX - half * 1.15, hem],
    ],
    accent,
  );
  canvas.polygon(
    [
      [midX - half, shoulder],
      [midX - half * 1.7, shoulder + height * 0.06],
      [midX - half * 1.35, hem * 0.82],
      [midX - half, hem * 0.74],
    ],
    accent,
  );
  canvas.polygon(
    [
      [midX + half, shoulder],
      [midX + half * 1.7, shoulder + height * 0.06],
      [midX + half * 1.35, hem * 0.82],
      [midX + half, hem * 0.74],
    ],
    accent,
  );
  canvas.circle(midX, shoulder - height * 0.055, height * 0.05, detail);
  canvas.rect(midX - 1.5, shoulder, 3, hem - shoulder, detail);

  const buttons = 3 + (variant % 3);
  for (let index = 1; index <= buttons; index += 1) {
    canvas.circle(midX, shoulder + ((hem - shoulder) * index) / (buttons + 2), 7, ground);
  }
  canvas.rect(width * 0.1, height * 0.88, width * 0.8, 3, ink);

  return { ...writePng({ width, height, data: canvas.data }), contentType: 'image/png' };
}
