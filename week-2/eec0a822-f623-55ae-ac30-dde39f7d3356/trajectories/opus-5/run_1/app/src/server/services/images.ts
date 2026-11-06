import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

export type ImageFormat = 'jpeg' | 'png';

export interface NormalisedImage {
  readonly format: ImageFormat;
  readonly contentType: string;
  readonly extension: 'jpg' | 'png';
  readonly content: Buffer;
  readonly width: number;
  readonly height: number;
}

interface Pixels {
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
}

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function formatOf(content: Buffer): ImageFormat | null {
  if (content.subarray(0, 3).equals(JPEG_MAGIC)) return 'jpeg';
  if (content.subarray(0, 8).equals(PNG_MAGIC)) return 'png';
  return null;
}

function orientationFromTiff(tiff: Buffer): number {
  if (tiff.length < 8) return 1;
  const byteOrder = tiff.toString('latin1', 0, 2);
  const little = byteOrder === 'II';
  if (!little && byteOrder !== 'MM') return 1;
  const readShort = (offset: number): number =>
    little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
  const readLong = (offset: number): number =>
    little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);
  const ifdOffset = readLong(4);
  if (ifdOffset + 2 > tiff.length) return 1;
  const count = readShort(ifdOffset);
  for (let index = 0; index < count; index += 1) {
    const entry = ifdOffset + 2 + index * 12;
    if (entry + 12 > tiff.length) break;
    if (readShort(entry) === 0x0112) {
      const value = readShort(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

function jpegOrientation(content: Buffer): number {
  let offset = 2;
  while (offset + 4 <= content.length) {
    if (content[offset] !== 0xff) break;
    const marker = content[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = content.readUInt16BE(offset + 2);
    if (marker === 0xe1 && content.toString('latin1', offset + 4, offset + 10) === 'Exif\0\0') {
      return orientationFromTiff(content.subarray(offset + 10, offset + 2 + length));
    }
    if (marker === 0xda) break;
    offset += 2 + length;
  }
  return 1;
}

function pngOrientation(content: Buffer): number {
  let offset = 8;
  while (offset + 8 <= content.length) {
    const length = content.readUInt32BE(offset);
    const type = content.toString('latin1', offset + 4, offset + 8);
    if (type === 'eXIf') {
      return orientationFromTiff(content.subarray(offset + 8, offset + 8 + length));
    }
    if (type === 'IDAT' || type === 'IEND') break;
    offset += 12 + length;
  }
  return 1;
}

function applyOrientation(pixels: Pixels, orientation: number): Pixels {
  if (orientation === 1) return pixels;
  const swapped = orientation >= 5;
  const width = swapped ? pixels.height : pixels.width;
  const height = swapped ? pixels.width : pixels.height;
  const output = Buffer.alloc(width * height * 4);
  for (let y = 0; y < pixels.height; y += 1) {
    for (let x = 0; x < pixels.width; x += 1) {
      const [targetX, targetY] = mapPixel(orientation, x, y, pixels.width, pixels.height);
      pixels.data.copy(output, (targetY * width + targetX) * 4, (y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 4);
    }
  }
  return { data: output, width, height };
}

function mapPixel(
  orientation: number,
  x: number,
  y: number,
  width: number,
  height: number,
): [number, number] {
  switch (orientation) {
    case 2:
      return [width - 1 - x, y];
    case 3:
      return [width - 1 - x, height - 1 - y];
    case 4:
      return [x, height - 1 - y];
    case 5:
      return [y, x];
    case 6:
      return [height - 1 - y, x];
    case 7:
      return [height - 1 - y, width - 1 - x];
    default:
      return [y, width - 1 - x];
  }
}

/** Decodes a passport photo, applies its camera orientation and drops every other tag. */
export function normalisePhoto(content: Buffer): NormalisedImage | null {
  const format = formatOf(content);
  if (format === null) return null;
  try {
    if (format === 'jpeg') {
      const decoded = jpeg.decode(content, { useTArray: true, formatAsRGBA: true });
      const oriented = applyOrientation(
        { data: Buffer.from(decoded.data), width: decoded.width, height: decoded.height },
        jpegOrientation(content),
      );
      const encoded = jpeg.encode(
        { data: oriented.data, width: oriented.width, height: oriented.height },
        90,
      );
      return {
        format,
        contentType: 'image/jpeg',
        extension: 'jpg',
        content: Buffer.from(encoded.data),
        width: oriented.width,
        height: oriented.height,
      };
    }
    const decoded = PNG.sync.read(content);
    const oriented = applyOrientation(
      { data: Buffer.from(decoded.data), width: decoded.width, height: decoded.height },
      pngOrientation(content),
    );
    const output = new PNG({ width: oriented.width, height: oriented.height });
    oriented.data.copy(output.data);
    return {
      format,
      contentType: 'image/png',
      extension: 'png',
      content: PNG.sync.write(output),
      width: oriented.width,
      height: oriented.height,
    };
  } catch {
    return null;
  }
}
