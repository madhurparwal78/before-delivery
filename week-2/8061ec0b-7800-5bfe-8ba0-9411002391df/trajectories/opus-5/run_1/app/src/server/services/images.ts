import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { decode as decodeWebp } from '@cwasm/webp';

export const MAX_PHOTO_BYTES = 5000000;
export const MAX_PHOTO_PIXELS = 8000;

export type PhotoFormat = 'jpeg' | 'png' | 'webp';

export type PhotoRefusal = 'photo_too_large' | 'unsupported_image' | 'dimensions';

export class PhotoRefused extends Error {
  constructor(readonly refusal: PhotoRefusal) {
    super(refusal);
  }
}

/** The format judged by the bytes themselves, never by name or declared type. */
export function sniffFormat(bytes: Buffer): PhotoFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    const length = bytes.readUInt16BE(offset + 2);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function webpDimensions(bytes: Buffer): { width: number; height: number } | null {
  const chunk = bytes.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8X' && bytes.length >= 30) {
    const width = 1 + (bytes.readUIntLE(24, 3) & 0xffffff);
    const height = 1 + (bytes.readUIntLE(27, 3) & 0xffffff);
    return { width, height };
  }
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L' && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

export function photoDimensions(bytes: Buffer, format: PhotoFormat): { width: number; height: number } | null {
  switch (format) {
    case 'jpeg':
      return jpegDimensions(bytes);
    case 'png':
      return pngDimensions(bytes);
    case 'webp':
      return webpDimensions(bytes);
  }
}

interface RawImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

function decodePhoto(bytes: Buffer, format: PhotoFormat): RawImage {
  switch (format) {
    case 'jpeg': {
      const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
      return { width: decoded.width, height: decoded.height, data: decoded.data };
    }
    case 'png': {
      const decoded = PNG.sync.read(bytes);
      return { width: decoded.width, height: decoded.height, data: decoded.data };
    }
    case 'webp': {
      const decoded = decodeWebp(bytes);
      return { width: decoded.width, height: decoded.height, data: decoded.data };
    }
  }
}

/**
 * Checks one photo in upload order and re-encodes it as JPEG at the same pixel size,
 * dropping every metadata segment the source carried.
 */
export function processPhoto(bytes: Buffer): Buffer {
  if (bytes.length > MAX_PHOTO_BYTES) throw new PhotoRefused('photo_too_large');
  const format = sniffFormat(bytes);
  if (format === null) throw new PhotoRefused('unsupported_image');
  const size = photoDimensions(bytes, format);
  if (size === null) throw new PhotoRefused('unsupported_image');
  if (size.width > MAX_PHOTO_PIXELS || size.height > MAX_PHOTO_PIXELS) throw new PhotoRefused('dimensions');
  let raw: RawImage;
  try {
    raw = decodePhoto(bytes, format);
  } catch {
    throw new PhotoRefused('unsupported_image');
  }
  const encoded = jpeg.encode({ data: Buffer.from(raw.data), width: raw.width, height: raw.height }, 85);
  return Buffer.from(encoded.data);
}
