import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

export interface Raster {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Buffer;
}

export type OriginalType = 'image/jpeg' | 'image/png';

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The type of an upload is decided only by its leading bytes. */
export function sniffOriginalType(bytes: Buffer): OriginalType | null {
  if (bytes.subarray(0, 3).equals(JPEG_MAGIC)) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  return null;
}

export function decodeRaster(bytes: Buffer, type: OriginalType): Raster | null {
  try {
    if (type === 'image/jpeg') {
      const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
      return { width: decoded.width, height: decoded.height, data: Buffer.from(decoded.data) };
    }
    const decoded = PNG.sync.read(bytes);
    return { width: decoded.width, height: decoded.height, data: Buffer.from(decoded.data) };
  } catch {
    return null;
  }
}

function sample(raster: Raster, x: number, y: number): [number, number, number] {
  const clampedX = Math.min(raster.width - 1, Math.max(0, x));
  const clampedY = Math.min(raster.height - 1, Math.max(0, y));
  const offset = (clampedY * raster.width + clampedX) * 4;
  return [raster.data[offset] ?? 0, raster.data[offset + 1] ?? 0, raster.data[offset + 2] ?? 0];
}

function resample(raster: Raster, box: { x: number; y: number; width: number; height: number }, width: number, height: number): Raster {
  const data = Buffer.alloc(width * height * 4, 255);
  const scaleX = box.width / width;
  const scaleY = box.height / height;
  for (let y = 0; y < height; y += 1) {
    const sourceY = box.y + (y + 0.5) * scaleY - 0.5;
    const y0 = Math.floor(sourceY);
    const weightY = sourceY - y0;
    for (let x = 0; x < width; x += 1) {
      const sourceX = box.x + (x + 0.5) * scaleX - 0.5;
      const x0 = Math.floor(sourceX);
      const weightX = sourceX - x0;
      const topLeft = sample(raster, x0, y0);
      const topRight = sample(raster, x0 + 1, y0);
      const bottomLeft = sample(raster, x0, y0 + 1);
      const bottomRight = sample(raster, x0 + 1, y0 + 1);
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const top = (topLeft[channel] ?? 0) * (1 - weightX) + (topRight[channel] ?? 0) * weightX;
        const bottom = (bottomLeft[channel] ?? 0) * (1 - weightX) + (bottomRight[channel] ?? 0) * weightX;
        data[offset + channel] = Math.round(top * (1 - weightY) + bottom * weightY);
      }
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

function centreSquare(raster: Raster, size: number): Raster {
  const edge = Math.min(raster.width, raster.height);
  return resample(
    raster,
    {
      x: Math.floor((raster.width - edge) / 2),
      y: Math.floor((raster.height - edge) / 2),
      width: edge,
      height: edge,
    },
    size,
    size,
  );
}

function longestEdge(raster: Raster, edge: number): Raster {
  const scale = Math.min(1, edge / Math.max(raster.width, raster.height));
  const width = Math.max(1, Math.round(raster.width * scale));
  const height = Math.max(1, Math.round(raster.height * scale));
  return resample(raster, { x: 0, y: 0, width: raster.width, height: raster.height }, width, height);
}

const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

const WATERMARK_TEXT = 'SALTPRINT PREVIEW';

function stampWatermark(raster: Raster): void {
  const angle = -Math.PI / 6;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const textWidth = WATERMARK_TEXT.length * 6 - 1;
  const scale = Math.max(2, Math.floor((raster.width * 0.8) / textWidth));
  const originX = raster.width / 2 - (textWidth * scale * cos) / 2;
  const originY = raster.height / 2 - (textWidth * scale * sin) / 2 - (7 * scale) / 2;
  for (let index = 0; index < WATERMARK_TEXT.length; index += 1) {
    const rows = GLYPHS[WATERMARK_TEXT[index] as string];
    if (!rows) continue;
    for (let row = 0; row < rows.length; row += 1) {
      const line = rows[row] as string;
      for (let column = 0; column < line.length; column += 1) {
        if (line[column] !== '1') continue;
        const textX = (index * 6 + column) * scale;
        const textY = row * scale;
        const baseX = originX + textX * cos - textY * sin;
        const baseY = originY + textX * sin + textY * cos;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const x = Math.round(baseX + dx * cos - dy * sin);
            const y = Math.round(baseY + dx * sin + dy * cos);
            if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) continue;
            const offset = (y * raster.width + x) * 4;
            for (let channel = 0; channel < 3; channel += 1) {
              const current = raster.data[offset + channel] ?? 0;
              raster.data[offset + channel] = Math.round(current * 0.35 + 255 * 0.65);
            }
          }
        }
      }
    }
  }
}

function encodeJpeg(raster: Raster, quality: number): Buffer {
  const encoded = jpeg.encode({ data: raster.data, width: raster.width, height: raster.height }, quality);
  return Buffer.from(encoded.data);
}

export interface Derivatives {
  grid: Buffer;
  story: Buffer;
  preview: Buffer;
}

/** A 600x600 centre square crop. */
export function gridDerivative(raster: Raster): Buffer {
  return encodeJpeg(centreSquare(raster, 600), 82);
}

/** Longest edge 1600 pixels. */
export function storyDerivative(raster: Raster): Buffer {
  return encodeJpeg(longestEdge(raster, 1600), 82);
}

/** Longest edge 1200 pixels, with the diagonal preview watermark. */
export function previewDerivative(raster: Raster): Buffer {
  const preview = longestEdge(raster, 1200);
  stampWatermark(preview);
  return encodeJpeg(preview, 80);
}

/** Grid, story and preview JPEGs, carrying no metadata from the original. */
export function buildDerivatives(raster: Raster): Derivatives {
  return {
    grid: gridDerivative(raster),
    story: storyDerivative(raster),
    preview: previewDerivative(raster),
  };
}

function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/** A procedurally generated halftone plate: one tone per halftone cell, one dot per cell. */
export function halftoneRaster(seedText: string, width = 1600, height = 1200): Raster {
  const seed = hashSeed(seedText);
  const data = Buffer.alloc(width * height * 4, 255);
  const cell = 6 + (seed % 3) * 2;
  const horizon = 0.3 + (seed % 37) / 100;
  const sunX = 0.15 + ((seed >> 4) % 70) / 100;
  const grain = 8 + ((seed >> 7) % 14);
  const swell = 30 + ((seed >> 11) % 50);
  const half = cell / 2;
  for (let cellTop = 0; cellTop < height; cellTop += cell) {
    for (let cellLeft = 0; cellLeft < width; cellLeft += cell) {
      const u = (cellLeft + half) / width;
      const v = (cellTop + half) / height;
      const sky = Math.max(0, 1 - Math.abs(v - horizon) * 2.2);
      const sun = Math.exp(-(((u - sunX) ** 2 + (v - horizon * 0.6) ** 2) * 40));
      const ground =
        v > horizon ? 0.55 + 0.25 * Math.sin((u * grain + v * (grain / 2) + seed) % Math.PI) : 0.18;
      const ripple = 0.08 * Math.sin(u * swell + Math.sin(v * (swell / 2.5) + seed) * 2);
      const tone = Math.min(1, Math.max(0, ground + sky * 0.3 + sun * 0.5 + ripple));
      const radius = (1 - tone) * half * 1.35;
      const radiusSquared = radius * radius;
      const paper = 232 - Math.round(tone * 28);
      const ink = 24 + ((seed + cellLeft + cellTop) % 12);
      for (let y = cellTop; y < Math.min(height, cellTop + cell); y += 1) {
        const dy = y - cellTop - half + 0.5;
        for (let x = cellLeft; x < Math.min(width, cellLeft + cell); x += 1) {
          const dx = x - cellLeft - half + 0.5;
          const value = dx * dx + dy * dy <= radiusSquared ? ink : paper;
          const offset = (y * width + x) * 4;
          data[offset] = value;
          data[offset + 1] = value;
          data[offset + 2] = value;
        }
      }
    }
  }
  return { width, height, data };
}

export function encodeOriginal(raster: Raster): Buffer {
  return encodeJpeg(raster, 86);
}
