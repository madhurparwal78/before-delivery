import { inflateSync } from 'node:zlib';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

/**
 * The one place where a photograph's type, header dimensions and upright pixels are decided.
 * Every pixel computation in the app works on the upright image.
 */

export type PhotoType = 'image/jpeg' | 'image/png';

export const MAX_PHOTO_BYTES = 15_000_000;
export const MAX_UPRIGHT_PIXELS = 40_000_000;
export const MAX_UPRIGHT_SIDE = 12_000;
export const DISPLAY_CROP_SIDE = 1200;

export interface PhotoHeader {
  /** Pixel dimensions as stored, before the orientation tag is applied. */
  storedWidth: number;
  storedHeight: number;
  /** Pixel dimensions once the orientation tag has turned the image upright. */
  width: number;
  height: number;
  orientation: number;
  /** False when the file is too short to hold the raster its header describes. */
  complete: boolean;
}

export interface UprightImage {
  width: number;
  height: number;
  /** RGBA, 8 bits a channel, as stored in the file's own colour space. */
  data: Uint8Array;
}

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((value, index) => bytes[index] === value);
}

/** The type is decided only from the first bytes. Filenames and part headers are ignored. */
export function sniffPhotoType(bytes: Uint8Array): PhotoType | null {
  if (startsWith(bytes, JPEG_MAGIC)) return 'image/jpeg';
  if (startsWith(bytes, PNG_MAGIC)) return 'image/png';
  return null;
}

export function extensionFor(type: PhotoType): string {
  return type === 'image/jpeg' ? 'jpg' : 'png';
}

/** Width and height swap for orientation values 5 to 8. */
function uprightDimensions(
  width: number,
  height: number,
  orientation: number,
): { width: number; height: number } {
  return orientation >= 5 && orientation <= 8
    ? { width: height, height: width }
    : { width, height };
}

/** Reads dimensions and the orientation tag from the file's own header, decoding nothing. */
export function readPhotoHeader(bytes: Uint8Array, type: PhotoType): PhotoHeader | null {
  const raw = type === 'image/jpeg' ? readJpegHeader(bytes) : readPngHeader(bytes);
  if (!raw) return null;
  const upright = uprightDimensions(raw.width, raw.height, raw.orientation);
  return {
    storedWidth: raw.width,
    storedHeight: raw.height,
    width: upright.width,
    height: upright.height,
    orientation: raw.orientation,
    complete: raw.complete,
  };
}

interface RawHeader {
  width: number;
  height: number;
  orientation: number;
  complete: boolean;
}

/** The most a deflate stream can expand, used to spot a file too short for its own header. */
const MAX_DEFLATE_RATIO = 1032;

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function readJpegHeader(bytes: Uint8Array): RawHeader | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  let orientation = 1;
  let dimensions: { width: number; height: number } | null = null;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const length = view.getUint16(offset + 2);
    if (length < 2) return null;
    const segment = bytes.subarray(offset + 4, offset + 2 + length);
    if (SOF_MARKERS.has(marker) && segment.length >= 5) {
      dimensions = {
        height: (segment[1]! << 8) | segment[2]!,
        width: (segment[3]! << 8) | segment[4]!,
      };
      if (orientation !== 1) break;
    } else if (marker === 0xe1 && isExifSegment(segment)) {
      orientation = readExifOrientation(segment.subarray(6)) ?? 1;
    }
    offset += 2 + length;
    if (dimensions && orientation !== 1) break;
  }
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) return null;
  // A truncated JPEG is caught by the decoder, which refuses it.
  return { ...dimensions, orientation, complete: true };
}

function isExifSegment(segment: Uint8Array): boolean {
  return (
    segment.length > 6 &&
    segment[0] === 0x45 &&
    segment[1] === 0x78 &&
    segment[2] === 0x69 &&
    segment[3] === 0x66 &&
    segment[4] === 0x00
  );
}

function readExifOrientation(tiff: Uint8Array): number | null {
  if (tiff.length < 8) return null;
  const littleEndian = tiff[0] === 0x49 && tiff[1] === 0x49;
  const bigEndian = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!littleEndian && !bigEndian) return null;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const ifdOffset = view.getUint32(4, littleEndian);
  if (ifdOffset + 2 > tiff.length) return null;
  const entries = view.getUint16(ifdOffset, littleEndian);
  for (let index = 0; index < entries; index += 1) {
    const entry = ifdOffset + 2 + index * 12;
    if (entry + 12 > tiff.length) return null;
    if (view.getUint16(entry, littleEndian) === 0x0112) {
      const value = view.getUint16(entry + 8, littleEndian);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

interface PngChunk {
  type: string;
  data: Uint8Array;
}

function* pngChunks(bytes: Uint8Array): Generator<PngChunk> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const start = offset + 8;
    if (start + length > bytes.length) return;
    yield { type, data: bytes.subarray(start, start + length) };
    if (type === 'IEND') return;
    offset = start + length + 4;
  }
}

const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function readPngHeader(bytes: Uint8Array): RawHeader | null {
  let dimensions: { width: number; height: number } | null = null;
  let orientation = 1;
  let bitDepth = 8;
  let colourType = 6;
  let compressedBytes = 0;
  for (const chunk of pngChunks(bytes)) {
    if (chunk.type === 'IHDR' && chunk.data.length >= 10) {
      const view = new DataView(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);
      dimensions = { width: view.getUint32(0), height: view.getUint32(4) };
      bitDepth = chunk.data[8]!;
      colourType = chunk.data[9]!;
    } else if (chunk.type === 'eXIf') {
      const payload = isExifSegment(chunk.data) ? chunk.data.subarray(6) : chunk.data;
      orientation = readExifOrientation(payload) ?? 1;
    } else if (chunk.type === 'IDAT') {
      compressedBytes += chunk.data.length;
    }
  }
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) return null;
  const channels = PNG_CHANNELS[colourType] ?? 0;
  if (channels === 0) return null;
  const rowBytes = 1 + Math.ceil((dimensions.width * channels * bitDepth) / 8);
  const rasterBytes = rowBytes * dimensions.height;
  return {
    ...dimensions,
    orientation,
    complete: compressedBytes * MAX_DEFLATE_RATIO >= rasterBytes,
  };
}

/** The description of the embedded colour profile, when there is one. */
export function readColourProfileDescription(
  bytes: Uint8Array,
  type: PhotoType,
): string | null {
  const profile = type === 'image/jpeg' ? readJpegIcc(bytes) : readPngIcc(bytes);
  return profile ? readIccDescription(profile) : null;
}

function readJpegIcc(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const marker = 'ICC_PROFILE\0';
  const chunks: Array<{ sequence: number; data: Uint8Array }> = [];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const code = bytes[offset + 1] ?? 0;
    if (code === 0xd8 || code === 0x01 || (code >= 0xd0 && code <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (code === 0xd9 || code === 0xda) break;
    const length = view.getUint16(offset + 2);
    if (length < 2) break;
    const segment = bytes.subarray(offset + 4, offset + 2 + length);
    if (code === 0xe2 && segment.length > marker.length + 2) {
      const header = Buffer.from(segment.subarray(0, marker.length)).toString('latin1');
      if (header === marker) {
        chunks.push({
          sequence: segment[marker.length]!,
          data: segment.subarray(marker.length + 2),
        });
      }
    }
    offset += 2 + length;
  }
  if (chunks.length === 0) return null;
  chunks.sort((a, b) => a.sequence - b.sequence);
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data)));
}

function readPngIcc(bytes: Uint8Array): Uint8Array | null {
  for (const chunk of pngChunks(bytes)) {
    if (chunk.type === 'iCCP') {
      const nullIndex = chunk.data.indexOf(0);
      if (nullIndex < 0) return null;
      try {
        return inflateSync(Buffer.from(chunk.data.subarray(nullIndex + 2)));
      } catch {
        return null;
      }
    }
    if (chunk.type === 'IDAT') break;
  }
  return null;
}

function readIccDescription(profile: Uint8Array): string | null {
  if (profile.length < 132) return null;
  const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
  const tagCount = view.getUint32(128);
  for (let index = 0; index < tagCount; index += 1) {
    const entry = 132 + index * 12;
    if (entry + 12 > profile.length) return null;
    const signature = Buffer.from(profile.subarray(entry, entry + 4)).toString('latin1');
    if (signature !== 'desc') continue;
    const offset = view.getUint32(entry + 4);
    const size = view.getUint32(entry + 8);
    if (offset + size > profile.length) return null;
    return readTextTag(profile.subarray(offset, offset + size));
  }
  return null;
}

function readTextTag(tag: Uint8Array): string | null {
  if (tag.length < 12) return null;
  const view = new DataView(tag.buffer, tag.byteOffset, tag.byteLength);
  const type = Buffer.from(tag.subarray(0, 4)).toString('latin1');
  if (type === 'desc') {
    const length = view.getUint32(8);
    return Buffer.from(tag.subarray(12, 12 + Math.max(0, length - 1))).toString('latin1');
  }
  if (type === 'mluc') {
    const records = view.getUint32(8);
    if (records === 0) return null;
    const length = view.getUint32(20);
    const offset = view.getUint32(24);
    if (length === 0 || offset + length > tag.length) return null;
    // Multi-localised Unicode records hold UTF-16 big-endian text.
    const text = Buffer.from(tag.subarray(offset, offset + length));
    text.swap16();
    return text.toString('utf16le');
  }
  return null;
}

/** Decodes to RGBA and turns the pixels upright, as the orientation tag describes. */
export function decodeUpright(bytes: Uint8Array, type: PhotoType, orientation: number): UprightImage {
  const decoded =
    type === 'image/jpeg' ? decodeJpeg(bytes) : decodePng(bytes);
  return applyOrientation(decoded, orientation);
}

function decodeJpeg(bytes: Uint8Array): UprightImage {
  const raw = jpeg.decode(Buffer.from(bytes), {
    useTArray: true,
    formatAsRGBA: true,
    maxMemoryUsageInMB: 1024,
    maxResolutionInMP: MAX_UPRIGHT_PIXELS / 1_000_000,
  });
  return { width: raw.width, height: raw.height, data: raw.data };
}

function decodePng(bytes: Uint8Array): UprightImage {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

function applyOrientation(image: UprightImage, orientation: number): UprightImage {
  if (orientation === 1) return image;
  const { width, height, data } = image;
  const swapped = orientation >= 5;
  const outWidth = swapped ? height : width;
  const outHeight = swapped ? width : height;
  const out = new Uint8Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const source = sourcePixel(orientation, x, y, width, height);
      const from = (source.y * width + source.x) * 4;
      const to = (y * outWidth + x) * 4;
      out[to] = data[from]!;
      out[to + 1] = data[from + 1]!;
      out[to + 2] = data[from + 2]!;
      out[to + 3] = data[from + 3]!;
    }
  }
  return { width: outWidth, height: outHeight, data: out };
}

function sourcePixel(
  orientation: number,
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } {
  switch (orientation) {
    case 2:
      return { x: width - 1 - x, y };
    case 3:
      return { x: width - 1 - x, y: height - 1 - y };
    case 4:
      return { x, y: height - 1 - y };
    case 5:
      return { x: y, y: x };
    case 6:
      return { x: y, y: height - 1 - x };
    case 7:
      return { x: width - 1 - y, y: height - 1 - x };
    case 8:
      return { x: width - 1 - y, y: x };
    default:
      return { x, y };
  }
}

/**
 * The display crop: a centred square of the upright image, 1200 pixels a side or the short
 * side when that is smaller, in sRGB and carrying no metadata at all.
 */
export function renderDisplayCrop(
  image: UprightImage,
  toSrgb: (rgb: [number, number, number]) => [number, number, number],
): Buffer {
  const side = Math.min(image.width, image.height);
  const left = Math.floor((image.width - side) / 2);
  const top = Math.floor((image.height - side) / 2);
  const outSide = Math.min(DISPLAY_CROP_SIDE, side);
  const out = new Uint8Array(outSide * outSide * 4);
  for (let y = 0; y < outSide; y += 1) {
    const y0 = top + Math.floor((y * side) / outSide);
    const y1 = Math.max(y0 + 1, top + Math.floor(((y + 1) * side) / outSide));
    for (let x = 0; x < outSide; x += 1) {
      const x0 = left + Math.floor((x * side) / outSide);
      const x1 = Math.max(x0 + 1, left + Math.floor(((x + 1) * side) / outSide));
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const index = (sy * image.width + sx) * 4;
          red += image.data[index]!;
          green += image.data[index + 1]!;
          blue += image.data[index + 2]!;
          count += 1;
        }
      }
      const converted = toSrgb([red / count, green / count, blue / count]);
      const target = (y * outSide + x) * 4;
      out[target] = converted[0];
      out[target + 1] = converted[1];
      out[target + 2] = converted[2];
      out[target + 3] = 255;
    }
  }
  const encoded = jpeg.encode({ data: Buffer.from(out), width: outSide, height: outSide }, 86);
  return Buffer.from(encoded.data);
}
