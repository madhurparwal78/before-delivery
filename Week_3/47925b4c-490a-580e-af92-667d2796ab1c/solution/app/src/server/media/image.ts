import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

export interface ImageFacts {
  readonly type: 'jpeg' | 'png';
  readonly widthPx: number;
  readonly heightPx: number;
  readonly orientation: number;
}

export interface Raster {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readJpegFacts(bytes: Buffer): ImageFacts | null {
  let offset = 2;
  let width = 0;
  let height = 0;
  let orientation = 1;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const length = bytes.readUInt16BE(offset + 2);
    const payload = bytes.subarray(offset + 4, offset + 2 + length);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame && width === 0 && payload.length >= 5) {
      height = payload.readUInt16BE(1);
      width = payload.readUInt16BE(3);
    }
    if (marker === 0xe1 && payload.subarray(0, 6).toString('latin1') === 'Exif\0\0') {
      orientation = readExifOrientation(payload.subarray(6)) ?? 1;
    }
    offset += 2 + length;
  }
  if (width === 0 || height === 0) return null;
  return { type: 'jpeg', widthPx: width, heightPx: height, orientation };
}

function readExifOrientation(tiff: Buffer): number | null {
  if (tiff.length < 8) return null;
  const little = tiff.subarray(0, 2).toString('latin1') === 'II';
  const readShort = (at: number): number => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const readLong = (at: number): number => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const firstIfd = readLong(4);
  if (firstIfd + 2 > tiff.length) return null;
  const count = readShort(firstIfd);
  for (let index = 0; index < count; index += 1) {
    const entry = firstIfd + 2 + index * 12;
    if (entry + 12 > tiff.length) break;
    if (readShort(entry) === 0x0112) {
      const value = readShort(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** The type and size of a photo, read from its content alone. */
export function readImageFacts(bytes: Buffer): ImageFacts | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return readJpegFacts(bytes);
  }
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    if (bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width === 0 || height === 0) return null;
    return { type: 'png', widthPx: width, heightPx: height, orientation: 1 };
  }
  return null;
}

export function orientedSize(facts: ImageFacts): { readonly widthPx: number; readonly heightPx: number } {
  const turned = facts.orientation >= 5 && facts.orientation <= 8;
  return turned
    ? { widthPx: facts.heightPx, heightPx: facts.widthPx }
    : { widthPx: facts.widthPx, heightPx: facts.heightPx };
}

function decode(bytes: Buffer, facts: ImageFacts): Raster {
  if (facts.type === 'jpeg') {
    const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
    return { width: decoded.width, height: decoded.height, rgba: decoded.data };
  }
  const decoded = PNG.sync.read(bytes);
  return { width: decoded.width, height: decoded.height, rgba: new Uint8Array(decoded.data) };
}

/** The working copy, with the EXIF Orientation tag honoured. */
export function uprightRaster(bytes: Buffer, facts: ImageFacts): Raster {
  const source = decode(bytes, facts);
  if (facts.orientation === 1) return source;
  const turned = facts.orientation >= 5;
  const width = turned ? source.height : source.width;
  const height = turned ? source.width : source.height;
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const from = sourcePixel(facts.orientation, column, row, source.width, source.height);
      const target = (row * width + column) * 4;
      const origin = (from.y * source.width + from.x) * 4;
      rgba[target] = source.rgba[origin] ?? 0;
      rgba[target + 1] = source.rgba[origin + 1] ?? 0;
      rgba[target + 2] = source.rgba[origin + 2] ?? 0;
      rgba[target + 3] = source.rgba[origin + 3] ?? 255;
    }
  }
  return { width, height, rgba };
}

function sourcePixel(
  orientation: number,
  column: number,
  row: number,
  width: number,
  height: number,
): { readonly x: number; readonly y: number } {
  switch (orientation) {
    case 2:
      return { x: width - 1 - column, y: row };
    case 3:
      return { x: width - 1 - column, y: height - 1 - row };
    case 4:
      return { x: column, y: height - 1 - row };
    case 5:
      return { x: row, y: column };
    case 6:
      return { x: row, y: height - 1 - column };
    case 7:
      return { x: width - 1 - row, y: height - 1 - column };
    default:
      return { x: width - 1 - row, y: column };
  }
}
