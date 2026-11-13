import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array; // RGBA
}

export type ImageKind = 'jpeg' | 'png';

export const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function signatureMatches(bytes: Buffer, contentType: string): boolean {
  if (contentType === 'image/jpeg') return bytes.subarray(0, 3).equals(JPEG_SIGNATURE);
  if (contentType === 'image/png') return bytes.subarray(0, 8).equals(PNG_SIGNATURE);
  return false;
}

/** EXIF orientation 1..8; missing or invalid counts as 1. */
export function jpegOrientation(bytes: Buffer): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset < bytes.length - 1) {
    if (bytes[offset] !== 0xff) return 1;
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return 1;
    const length = bytes.readUInt16BE(offset + 2);
    if (marker === 0xe1) {
      const app1 = bytes.subarray(offset + 4, offset + 2 + length);
      if (app1.subarray(0, 6).toString('ascii') === 'Exif\0\0') {
        const tiff = app1.subarray(6);
        const endian = tiff.subarray(0, 2).toString('ascii');
        if (endian !== 'II' && endian !== 'MM') return 1;
        const little = endian === 'II';
        const readU16 = (p: number) => (little ? tiff.readUInt16LE(p) : tiff.readUInt16BE(p));
        const readU32 = (p: number) => (little ? tiff.readUInt32LE(p) : tiff.readUInt32BE(p));
        const ifdOffset = readU32(4);
        const entryCount = readU16(ifdOffset);
        for (let i = 0; i < entryCount; i += 1) {
          const entry = ifdOffset + 2 + i * 12;
          if (entry + 12 > tiff.length) break;
          if (readU16(entry) === 0x0112) {
            const value = readU16(entry + 8);
            if (value >= 1 && value <= 8) return value;
            return 1;
          }
        }
      }
    }
    offset += 2 + length;
  }
  return 1;
}

function rotateImage(image: RgbaImage, orientation: number): RgbaImage {
  const { width, height, data } = image;
  const transform = (h: boolean, v: boolean, swap: boolean): RgbaImage => {
    const outW = swap ? height : width;
    const outH = swap ? width : height;
    const out = new Uint8Array(outW * outH * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const srcIdx = (y * width + x) * 4;
        const nx = h ? width - 1 - x : x;
        const ny = v ? height - 1 - y : y;
        const [tx, ty] = swap ? [ny, nx] : [nx, ny];
        const dstIdx = (ty * outW + tx) * 4;
        out[dstIdx] = data[srcIdx];
        out[dstIdx + 1] = data[srcIdx + 1];
        out[dstIdx + 2] = data[srcIdx + 2];
        out[dstIdx + 3] = data[srcIdx + 3];
      }
    }
    return { width: outW, height: outH, data: out };
  };
  switch (orientation) {
    case 2: return transform(true, false, false);
    case 3: return transform(true, true, false);
    case 4: return transform(false, true, false);
    case 5: return transform(true, false, true);
    case 6: return transform(false, true, true);
    case 7: return transform(true, true, true);
    case 8: return transform(true, false, true);
    default: return image;
  }
}

export function decodeImage(bytes: Buffer, kind: ImageKind): RgbaImage | null {
  try {
    if (kind === 'jpeg') {
      const decoded = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 1024 });
      return { width: decoded.width, height: decoded.height, data: new Uint8Array(decoded.data) };
    }
    const png = PNG.sync.read(bytes);
    return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
  } catch {
    return null;
  }
}

export function resize(image: RgbaImage, targetLong: number): RgbaImage {
  const long = Math.max(image.width, image.height);
  if (long <= targetLong) return image;
  const scale = targetLong / long;
  const outW = Math.max(1, Math.round(image.width * scale));
  const outH = Math.max(1, Math.round(image.height * scale));
  const out = new Uint8Array(outW * outH * 4);
  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      const srcX = Math.min(image.width - 1, Math.floor((x * image.width) / outW));
      const srcY = Math.min(image.height - 1, Math.floor((y * image.height) / outH));
      const srcIdx = (srcY * image.width + srcX) * 4;
      const dstIdx = (y * outW + x) * 4;
      out[dstIdx] = image.data[srcIdx];
      out[dstIdx + 1] = image.data[srcIdx + 1];
      out[dstIdx + 2] = image.data[srcIdx + 2];
      out[dstIdx + 3] = image.data[srcIdx + 3];
    }
  }
  return { width: outW, height: outH, data: out };
}

export function encodePng(image: RgbaImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  return PNG.sync.write(png, { deflateLevel: 6 });
}

export function encodeJpeg(image: RgbaImage, quality: number): Buffer {
  return jpeg.encode({ width: image.width, height: image.height, data: Buffer.from(image.data) }, quality).data;
}

export interface PhotoCopies {
  display: Buffer;
  thumb: Buffer;
  contentType: string;
  width: number;
  height: number;
}

/**
 * Build the upright display copy and thumbnail. EXIF orientation is applied,
 * both copies are re-encoded with no EXIF data, and the thumbnail's long edge
 * is 320 px (short edge rounded half up, at least 1; images at or under 320 keep size).
 */
export function buildCopies(bytes: Buffer, kind: ImageKind): PhotoCopies | null {
  const decoded = decodeImage(bytes, kind);
  if (!decoded) return null;
  const orientation = kind === 'jpeg' ? jpegOrientation(bytes) : 1;
  const upright = orientation === 1 ? decoded : rotateImage(decoded, orientation);
  const displayRgba = resize(upright, 1280);
  const thumbRgba = resize(upright, 320);
  const contentType = kind === 'jpeg' ? 'image/jpeg' : 'image/png';
  const display = kind === 'jpeg' ? encodeJpeg(displayRgba, 85) : encodePng(displayRgba);
  const thumb = kind === 'jpeg' ? encodeJpeg(thumbRgba, 80) : encodePng(thumbRgba);
  return { display, thumb, width: displayRgba.width, height: displayRgba.height, contentType };
}

export function pixelCount(bytes: Buffer, kind: ImageKind): number | null {
  const decoded = decodeImage(bytes, kind);
  return decoded ? decoded.width * decoded.height : null;
}
