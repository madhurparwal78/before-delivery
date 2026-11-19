import sharp from 'sharp';
import { ApiError } from './errors';

export type PhotoFormat = 'jpeg' | 'png' | 'webp';

export interface PhotoHeader {
  format: PhotoFormat;
  width: number;
  height: number;
}

/** Reads the image signature and header dimensions without decoding pixels. */
export function readPhotoHeader(buffer: Buffer): PhotoHeader | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    const dim = readJpegDimensions(buffer);
    if (dim) return { format: 'jpeg', ...dim };
  }
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer.subarray(1, 4).toString('ascii') === 'PNG') {
    const w = buffer.readUInt32BE(16);
    const h = buffer.readUInt32BE(20);
    if (w > 0 && h > 0) return { format: 'png', width: w, height: h };
  }
  if (buffer.length >= 30 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    const dim = readWebpDimensions(buffer);
    if (dim) return { format: 'webp', ...dim };
  }
  return null;
}

function readJpegDimensions(buf: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const h = buf.readUInt16BE(i + 5);
      const w = buf.readUInt16BE(i + 7);
      if (w > 0 && h > 0) return { width: w, height: h };
      return null;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function readWebpDimensions(buf: Buffer): { width: number; height: number } | null {
  const chunk = buf.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8 ') {
    if (buf.length < 30) return null;
    const w = buf.readUInt16LE(26) & 0x3fff;
    const h = buf.readUInt16LE(28) & 0x3fff;
    return { width: w, height: h };
  }
  if (chunk === 'VP8L') {
    if (buf.length < 25) return null;
    const bits = buf.readUInt32LE(21);
    const w = (bits & 0x3fff) + 1;
    const h = ((bits >> 14) & 0x3fff) + 1;
    return { width: w, height: h };
  }
  if (chunk === 'VP8X') {
    if (buf.length < 30) return null;
    const w = 1 + buf.readUIntLE(24, 3);
    const h = 1 + buf.readUIntLE(27, 3);
    return { width: w, height: h };
  }
  return null;
}

export interface ProcessedPhoto {
  original: Buffer;
  contentType: string;
  width: number;
  height: number;
  thumb: Buffer;
}

/**
 * Re-encodes the upload with orientation applied and all metadata removed,
 * then produces a JPEG thumbnail. One place decides the stored pixels (DP-14).
 */
export async function processPhoto(buffer: Buffer, format: PhotoFormat): Promise<ProcessedPhoto> {
  // Orientation applied, colours to sRGB, then a fresh encode from raw pixels
  // so no EXIF/XMP/IPTC/comment metadata survives (DP-14).
  const rotated = sharp(buffer, { failOn: 'error' }).rotate().toColorspace('srgb');
  const { data, info } = await rotated.raw().toBuffer({ resolveWithObject: true });
  const fresh = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
  let original: Buffer;
  let contentType: string;
  if (format === 'jpeg') {
    original = await fresh.jpeg({ quality: 88, chromaSubsampling: '4:2:0' }).toBuffer();
    contentType = 'image/jpeg';
  } else if (format === 'png') {
    original = await fresh.png().toBuffer();
    contentType = 'image/png';
  } else {
    original = await fresh.webp({ quality: 88 }).toBuffer();
    contentType = 'image/webp';
  }
  const meta = await sharp(original).metadata();
  const thumb = await sharp(original).resize(320, 320, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  return {
    original,
    contentType,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    thumb,
  };
}

/** Decodes the whole image; throws for undecodable input. */
export async function decodeCheck(buffer: Buffer): Promise<boolean> {
  const meta = await sharp(buffer).metadata();
  return (meta.width ?? 0) > 0 && (meta.height ?? 0) > 0;
}

export function photoValidationError(filename: string, reason: 'type' | 'size' | 'pixels' | 'tooMany'): ApiError {
  const files: Record<string, string> = {};
  switch (reason) {
    case 'type':
      files.files = `${filename} is not a JPEG, PNG or WebP photo.`;
      break;
    case 'size':
      files.files = `${filename} is over the photo size limit.`;
      break;
    case 'pixels':
      files.files = `${filename} is over the 40-megapixel limit.`;
      break;
    case 'tooMany':
      files.files = 'That is more photos than one message can carry.';
      break;
  }
  return new ApiError('validation', undefined, files);
}
