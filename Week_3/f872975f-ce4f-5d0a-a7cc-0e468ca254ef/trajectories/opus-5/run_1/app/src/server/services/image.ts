import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { MAX_PHOTO_PIXELS } from '../../shared/constants';
import { ApiError } from '../errors';

export type PhotoType = 'image/jpeg' | 'image/png';

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const THUMB_LONG_EDGE = 320;

export function extensionFor(type: PhotoType): 'jpg' | 'png' {
  return type === 'image/jpeg' ? 'jpg' : 'png';
}

/** The bytes must begin with the signature of the declared type. */
export function hasDeclaredSignature(body: Buffer, type: PhotoType): boolean {
  const signature = type === 'image/jpeg' ? JPEG_SIGNATURE : PNG_SIGNATURE;
  return body.length >= signature.length && body.subarray(0, signature.length).equals(signature);
}

interface Size {
  width: number;
  height: number;
}

function jpegSize(body: Buffer): Size | null {
  let offset = 2;
  while (offset + 3 < body.length) {
    if (body[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = body[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = body.readUInt16BE(offset + 2);
    const isFrameHeader =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isFrameHeader) {
      if (offset + 9 > body.length) return null;
      return { height: body.readUInt16BE(offset + 5), width: body.readUInt16BE(offset + 7) };
    }
    if (marker === 0xda) return null;
    offset += 2 + length;
  }
  return null;
}

function pngSize(body: Buffer): Size | null {
  if (body.length < 24 || body.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
}

function declaredSize(body: Buffer, type: PhotoType): Size | null {
  return type === 'image/jpeg' ? jpegSize(body) : pngSize(body);
}

/** The EXIF Orientation value of a JPEG, or 1 when it is missing or out of range. */
function jpegOrientation(body: Buffer): number {
  let offset = 2;
  while (offset + 3 < body.length) {
    if (body[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = body[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = body.readUInt16BE(offset + 2);
    if (marker === 0xda) return 1;
    if (marker === 0xe1 && body.toString('latin1', offset + 4, offset + 10) === 'Exif\0\0') {
      const found = readOrientationFromTiff(body, offset + 10, offset + 2 + length);
      if (found !== null) return found;
    }
    offset += 2 + length;
  }
  return 1;
}

function readOrientationFromTiff(body: Buffer, start: number, limit: number): number | null {
  if (start + 8 > limit) return null;
  const byteOrder = body.toString('latin1', start, start + 2);
  const little = byteOrder === 'II';
  if (!little && byteOrder !== 'MM') return null;
  const readU16 = (at: number): number => (little ? body.readUInt16LE(at) : body.readUInt16BE(at));
  const readU32 = (at: number): number => (little ? body.readUInt32LE(at) : body.readUInt32BE(at));
  const ifdOffset = readU32(start + 4);
  const ifd = start + ifdOffset;
  if (ifd + 2 > limit) return null;
  const count = readU16(ifd);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > limit) return null;
    if (readU16(entry) === 0x0112) {
      const value = readU16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

interface RasterImage {
  width: number;
  height: number;
  data: Buffer;
}

function decode(body: Buffer, type: PhotoType): RasterImage {
  try {
    if (type === 'image/jpeg') {
      const decoded = jpeg.decode(body, { useTArray: true, maxMemoryUsageInMB: 1024, maxResolutionInMP: 64 });
      return { width: decoded.width, height: decoded.height, data: Buffer.from(decoded.data) };
    }
    const decoded = PNG.sync.read(body);
    return { width: decoded.width, height: decoded.height, data: Buffer.from(decoded.data) };
  } catch {
    throw new ApiError('validation', { photo: 'That file is not a readable image.' });
  }
}

/** Applies an EXIF orientation to the pixels so the image stands upright. */
function applyOrientation(image: RasterImage, orientation: number): RasterImage {
  if (orientation === 1) return image;
  const swapped = orientation >= 5;
  const width = swapped ? image.height : image.width;
  const height = swapped ? image.width : image.height;
  const out = Buffer.allocUnsafe(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sx = x;
      let sy = y;
      switch (orientation) {
        case 2:
          sx = image.width - 1 - x;
          break;
        case 3:
          sx = image.width - 1 - x;
          sy = image.height - 1 - y;
          break;
        case 4:
          sy = image.height - 1 - y;
          break;
        case 5:
          sx = y;
          sy = x;
          break;
        case 6:
          sx = y;
          sy = image.height - 1 - x;
          break;
        case 7:
          sx = image.width - 1 - y;
          sy = image.height - 1 - x;
          break;
        default:
          sx = image.width - 1 - y;
          sy = x;
          break;
      }
      image.data.copy(out, (y * width + x) * 4, (sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4);
    }
  }
  return { width, height, data: out };
}

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

function thumbnailSize(width: number, height: number): Size {
  const longEdge = Math.max(width, height);
  if (longEdge <= THUMB_LONG_EDGE) return { width, height };
  const shortEdge = Math.max(1, roundHalfUp((Math.min(width, height) * THUMB_LONG_EDGE) / longEdge));
  return width >= height ? { width: THUMB_LONG_EDGE, height: shortEdge } : { width: shortEdge, height: THUMB_LONG_EDGE };
}

/** Area-average downscale. */
function resize(image: RasterImage, size: Size): RasterImage {
  if (size.width === image.width && size.height === image.height) return image;
  const out = Buffer.allocUnsafe(size.width * size.height * 4);
  const scaleX = image.width / size.width;
  const scaleY = image.height / size.height;
  for (let y = 0; y < size.height; y += 1) {
    const fromY = Math.floor(y * scaleY);
    const toY = Math.max(fromY + 1, Math.min(image.height, Math.floor((y + 1) * scaleY)));
    for (let x = 0; x < size.width; x += 1) {
      const fromX = Math.floor(x * scaleX);
      const toX = Math.max(fromX + 1, Math.min(image.width, Math.floor((x + 1) * scaleX)));
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let samples = 0;
      for (let sy = fromY; sy < toY; sy += 1) {
        for (let sx = fromX; sx < toX; sx += 1) {
          const at = (sy * image.width + sx) * 4;
          red += image.data[at] ?? 0;
          green += image.data[at + 1] ?? 0;
          blue += image.data[at + 2] ?? 0;
          alpha += image.data[at + 3] ?? 0;
          samples += 1;
        }
      }
      const at = (y * size.width + x) * 4;
      out[at] = Math.round(red / samples);
      out[at + 1] = Math.round(green / samples);
      out[at + 2] = Math.round(blue / samples);
      out[at + 3] = Math.round(alpha / samples);
    }
  }
  return { width: size.width, height: size.height, data: out };
}

function encode(image: RasterImage, type: PhotoType): Buffer {
  if (type === 'image/jpeg') {
    return Buffer.from(jpeg.encode({ data: image.data, width: image.width, height: image.height }, 85).data);
  }
  const png = new PNG({ width: image.width, height: image.height });
  image.data.copy(png.data);
  return PNG.sync.write(png);
}

export interface PreparedPhoto {
  display: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

/**
 * Turns uploaded bytes into an upright display copy and a thumbnail, both re-encoded
 * from the upright pixels and so free of EXIF data.
 */
export function preparePhoto(body: Buffer, type: PhotoType): PreparedPhoto {
  const size = declaredSize(body, type);
  if (size === null || size.width <= 0 || size.height <= 0) {
    throw new ApiError('validation', { photo: 'That file is not a readable image.' });
  }
  if (size.width * size.height > MAX_PHOTO_PIXELS) {
    throw new ApiError('validation', { photo: 'That photo has too many pixels.' });
  }
  const decoded = decode(body, type);
  const orientation = type === 'image/jpeg' ? jpegOrientation(body) : 1;
  const upright = applyOrientation(decoded, orientation);
  const thumb = resize(upright, thumbnailSize(upright.width, upright.height));
  return {
    display: encode(upright, type),
    thumb: encode(thumb, type),
    width: upright.width,
    height: upright.height
  };
}
