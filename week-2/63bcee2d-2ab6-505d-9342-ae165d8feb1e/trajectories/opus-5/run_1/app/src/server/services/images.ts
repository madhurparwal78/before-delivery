/**
 * Renders and site photos. Camera orientation is applied to the pixels and every
 * GPS and location field is removed before the bytes are stored.
 */

import jpeg from 'jpeg-js';
import { detectFileKind } from './files.js';

export interface PreparedImage {
  bytes: Buffer;
  contentType: string;
  width: number;
  height: number;
}

function readPngSize(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Rewrites a PNG keeping only the chunks that carry image data. */
function stripPngMetadata(bytes: Buffer): Buffer {
  const kept: Buffer[] = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('latin1');
    const end = offset + 12 + length;
    if (end > bytes.length) break;
    const carriesLocation = type === 'eXIf' || type === 'tEXt' || type === 'iTXt' || type === 'zTXt';
    if (!carriesLocation) kept.push(bytes.subarray(offset, end));
    offset = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(kept);
}

/** The EXIF orientation tag, or 1 when the JPEG carries none. */
function readJpegOrientation(bytes: Buffer): number {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1] as number;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) break;
    const segmentLength = bytes.readUInt16BE(offset + 2);
    if (marker === 0xe1 && bytes.subarray(offset + 4, offset + 10).toString('latin1') === 'Exif\0\0') {
      const tiff = offset + 10;
      const little = bytes.subarray(tiff, tiff + 2).toString('latin1') === 'II';
      const readShort = (at: number): number =>
        little ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at);
      const readLong = (at: number): number =>
        little ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at);
      const ifdOffset = readLong(tiff + 4);
      const ifd = tiff + ifdOffset;
      if (ifd + 2 <= bytes.length) {
        const entries = readShort(ifd);
        for (let index = 0; index < entries; index += 1) {
          const entry = ifd + 2 + index * 12;
          if (entry + 12 > bytes.length) break;
          if (readShort(entry) === 0x0112) {
            const value = readShort(entry + 8);
            return value >= 1 && value <= 8 ? value : 1;
          }
        }
      }
    }
    offset += 2 + segmentLength;
  }
  return 1;
}

interface RawPixels {
  data: Buffer;
  width: number;
  height: number;
}

/** Applies one of the eight EXIF orientations to the pixels themselves. */
function applyOrientation(source: RawPixels, orientation: number): RawPixels {
  if (orientation === 1) return source;
  const swapsAxes = orientation >= 5;
  const width = swapsAxes ? source.height : source.width;
  const height = swapsAxes ? source.width : source.height;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      let targetX: number;
      let targetY: number;
      switch (orientation) {
        case 2:
          targetX = source.width - 1 - x;
          targetY = y;
          break;
        case 3:
          targetX = source.width - 1 - x;
          targetY = source.height - 1 - y;
          break;
        case 4:
          targetX = x;
          targetY = source.height - 1 - y;
          break;
        case 5:
          targetX = y;
          targetY = x;
          break;
        case 6:
          targetX = source.height - 1 - y;
          targetY = x;
          break;
        case 7:
          targetX = source.height - 1 - y;
          targetY = source.width - 1 - x;
          break;
        default:
          targetX = y;
          targetY = source.width - 1 - x;
          break;
      }
      source.data.copy(
        data,
        (targetY * width + targetX) * 4,
        (y * source.width + x) * 4,
        (y * source.width + x) * 4 + 4,
      );
    }
  }
  return { data, width, height };
}

/**
 * Prepares an uploaded render or site photo for storage: PNG or JPEG only, with
 * orientation baked into the pixels and no metadata left behind.
 */
export function prepareImage(bytes: Buffer): PreparedImage | null {
  const kind = detectFileKind(bytes);
  if (kind === 'png') {
    const size = readPngSize(bytes);
    return {
      bytes: stripPngMetadata(bytes),
      contentType: 'image/png',
      width: size.width,
      height: size.height,
    };
  }
  if (kind !== 'jpeg') return null;
  const orientation = readJpegOrientation(bytes);
  const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
  const oriented = applyOrientation(
    { data: Buffer.from(decoded.data), width: decoded.width, height: decoded.height },
    orientation,
  );
  const encoded = jpeg.encode(
    { data: oriented.data, width: oriented.width, height: oriented.height },
    90,
  );
  return {
    bytes: Buffer.from(encoded.data),
    contentType: 'image/jpeg',
    width: oriented.width,
    height: oriented.height,
  };
}
