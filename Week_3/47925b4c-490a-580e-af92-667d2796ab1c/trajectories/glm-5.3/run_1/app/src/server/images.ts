// Image decoding and encoding with no floating-point decisions and no metadata.
// JPEG decode/encode via jpeg-js, PNG via pngjs; PNGs are written grey 8-bit with a
// deterministic byte layout so equal inputs give equal bytes.

import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

export interface RgbaImage {
  width: number;
  height: number;
  data: Buffer; // RGBA
}

export interface GreyImage {
  width: number;
  height: number;
  data: Buffer; // one byte per pixel
}

const JPEG_SOI = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sniffImageType(bytes: Buffer): 'jpeg' | 'png' | null {
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(JPEG_SOI)) return 'jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  return null;
}

// Reads EXIF Orientation (tag 0x0112) from a JPEG's APP1 segment; 1 when absent or invalid.
export function jpegOrientation(bytes: Buffer): number {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
      const marker = bytes[offset]!;
      const length = bytes.readUInt16BE(offset + 2);
      if (marker === 0xff && bytes[offset + 1] === 0xe1) {
      const segment = bytes.subarray(offset + 4, offset + 2 + length);
      if (segment.length >= 6 && segment.subarray(0, 6).toString('ascii') === 'Exif\0\0') {
        return readExifOrientation(segment.subarray(6));
      }
    }
    if (marker !== 0xff) return 1;
    if (bytes[offset + 1] === 0xd8 || (bytes[offset + 1]! >= 0xd0 && bytes[offset + 1]! <= 0xd9)) {
      offset += 2;
      continue;
    }
    offset += 2 + length;
  }
  return 1;
}

function readExifOrientation(tiff: Buffer): number {
  if (tiff.length < 8) return 1;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return 1;
  const readUInt16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const readUInt32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  if (readUInt32(4) < 8) return 1;
  const ifdOffset = readUInt32(4);
  if (ifdOffset + 2 > tiff.length) return 1;
  const entries = readUInt16(ifdOffset);
  for (let i = 0; i < entries; i++) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > tiff.length) return 1;
    if (readUInt16(entry) === 0x0112) {
      const value = readUInt16(entry + 8);
      if (value >= 1 && value <= 8) return value;
      return 1;
    }
  }
  return 1;
}

export function decodeJpeg(bytes: Buffer): RgbaImage | null {
  try {
    const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
    return { width: decoded.width, height: decoded.height, data: Buffer.from(decoded.data) };
  } catch {
    return null;
  }
}

export function decodePng(bytes: Buffer): RgbaImage | null {
  try {
    const png = PNG.sync.read(bytes);
    if (png.data.length !== png.width * png.height * 4) return null;
    return { width: png.width, height: png.height, data: png.data };
  } catch {
    return null;
  }
}

export function encodeJpeg(image: RgbaImage, quality = 90): Buffer {
  return jpeg.encode({ data: image.data, width: image.width, height: image.height }, quality).data;
}

export function encodePng(image: RgbaImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = image.data;
  return PNG.sync.write(png, { colorType: 6 });
}

// Grey 8-bit PNG with no metadata; used for mask tiles and mask bundle entries.
export function encodeGreyPng(image: GreyImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height, colorType: 0, inputHasAlpha: false });
  for (let i = 0; i < image.width * image.height; i++) {
    png.data[i] = image.data[i]!;
  }
  png.data = png.data.subarray(0, image.width * image.height);
  const out = PNG.sync.write(png, { colorType: 0, deflateLevel: 9 });
  return out;
}

// Applies the EXIF Orientation the brief's DP-04 honours, without touching the original.
export function uprightImage(image: RgbaImage, orientation: number): RgbaImage {
  switch (orientation) {
    case 2:
      return { ...image, data: flipHorizontally(image) };
    case 3:
      return { ...image, data: rotate180(image) };
    case 4:
      return { ...image, data: flipVertically(image) };
    case 5:
      return { width: image.height, height: image.width, data: transpose(image) };
    case 6:
      return { width: image.height, height: image.width, data: rotate90(image) };
    case 7:
      return { width: image.height, height: image.width, data: transverse(image) };
    case 8:
      return { width: image.height, height: image.width, data: rotate270(image) };
    default:
      return image;
  }
}

function flipHorizontally(image: RgbaImage): Buffer {
  const out = Buffer.alloc(image.data.length);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const src = (y * image.width + x) * 4;
      const dst = (y * image.width + (image.width - 1 - x)) * 4;
      image.data.copy(out, dst, src, src + 4);
    }
  }
  return out;
}

function flipVertically(image: RgbaImage): Buffer {
  const out = Buffer.alloc(image.data.length);
  for (let y = 0; y < image.height; y++) {
    const src = y * image.width * 4;
    const dst = (image.height - 1 - y) * image.width * 4;
    image.data.copy(out, dst, src, src + image.width * 4);
  }
  return out;
}

function rotate180(image: RgbaImage): Buffer {
  return flipHorizontally({ ...image, data: flipVertically(image) });
}

function rotate90(image: RgbaImage): Buffer {
  const out = Buffer.alloc(image.data.length);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const src = (y * image.width + x) * 4;
      const dst = (x * image.height + (image.height - 1 - y)) * 4;
      image.data.copy(out, dst, src, src + 4);
    }
  }
  return out;
}

function rotate270(image: RgbaImage): Buffer {
  const out = Buffer.alloc(image.data.length);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const src = (y * image.width + x) * 4;
      const dst = ((image.width - 1 - x) * image.height + y) * 4;
      image.data.copy(out, dst, src, src + 4);
    }
  }
  return out;
}

function transpose(image: RgbaImage): Buffer {
  const out = Buffer.alloc(image.data.length);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const src = (y * image.width + x) * 4;
      const dst = (x * image.height + y) * 4;
      image.data.copy(out, dst, src, src + 4);
    }
  }
  return out;
}

function transverse(image: RgbaImage): Buffer {
  return rotate90({ ...image, data: flipHorizontally(image) });
}

// Nearest-neighbour resample; every pixel coordinate the app works with stays exact.
export function resampleNearest(image: RgbaImage, width: number, height: number): RgbaImage {
  if (width === image.width && height === image.height) return image;
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcY = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x++) {
      const srcX = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const src = (srcY * image.width + srcX) * 4;
      const dst = (y * width + x) * 4;
      out[dst] = image.data[src]!;
      out[dst + 1] = image.data[src + 1]!;
      out[dst + 2] = image.data[src + 2]!;
      out[dst + 3] = image.data[src + 3]!;
    }
  }
  return { width, height, data: out };
}
