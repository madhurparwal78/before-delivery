// The photo pipeline (DP-10, DP-11): sniff the true content type, decode with the
// camera orientation applied, and re-encode a clean public copy with no metadata.
//
// Codecs: JPEG and WebP via jSquash's WASM (Apache-2.0), PNG via pngjs (MIT).

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const resolveWasm = (p: string) => readFileSync(require.resolve(p));

export type PhotoFormat = 'jpeg' | 'png' | 'webp';

/** The format the first bytes declare, whatever the file name or declared type (DP-10). */
export function sniffFormat(bytes: Uint8Array): PhotoFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'png';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp';
  return null;
}

export function contentTypeOf(format: PhotoFormat): string {
  switch (format) {
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
  }
}

interface ImageDataLike { data: Uint8ClampedArray; width: number; height: number }

// WASM modules are initialised once, from the files shipped inside the packages.
let jpegDecode: ((b: ArrayBuffer, o?: { preserveOrientation?: boolean }) => Promise<ImageDataLike>) | null = null;
let jpegEncode: ((d: ImageDataLike) => Promise<ArrayBuffer>) | null = null;
let webpDecode: ((b: ArrayBuffer) => Promise<ImageDataLike>) | null = null;
let webpEncode: ((d: ImageDataLike, o?: { quality?: number }) => Promise<ArrayBuffer>) | null = null;

async function loadJpeg(): Promise<void> {
  if (jpegDecode) return;
  const dec = await import('@jsquash/jpeg/decode.js');
  const enc = await import('@jsquash/jpeg/encode.js');
  await dec.init(await WebAssembly.compile(resolveWasm('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm')));
  await enc.init(await WebAssembly.compile(resolveWasm('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm')));
  jpegDecode = dec.default as unknown as typeof jpegDecode;
  jpegEncode = enc.default as unknown as typeof jpegEncode;
}

async function loadWebp(): Promise<void> {
  if (webpDecode) return;
  const dec = await import('@jsquash/webp/decode.js');
  const enc = await import('@jsquash/webp/encode.js');
  await dec.init(await WebAssembly.compile(resolveWasm('@jsquash/webp/codec/dec/webp_dec.wasm')));
  await enc.init(await WebAssembly.compile(resolveWasm('@jsquash/webp/codec/enc/webp_enc.wasm')));
  webpDecode = dec.default as unknown as typeof webpDecode;
  webpEncode = enc.default as typeof webpEncode;
}

export interface DecodedPhoto {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  format: PhotoFormat;
}

/** Decode a photo, applying the camera orientation for JPEGs (DP-11). */
export async function decodePhoto(bytes: Uint8Array, format: PhotoFormat): Promise<DecodedPhoto> {
  const copy = new Uint8Array(bytes);
  if (format === 'jpeg') {
    await loadJpeg();
    const img = await jpegDecode!(copy.buffer, { preserveOrientation: true });
    return { data: img.data, width: img.width, height: img.height, format };
  }
  if (format === 'webp') {
    await loadWebp();
    const img = await webpDecode!(copy.buffer);
    return { data: img.data, width: img.width, height: img.height, format };
  }
  // PNG: pngjs is CommonJS; the orientation tag is not a thing for PNG.
  const { PNG } = await import('pngjs');
  const png = PNG.sync.read(Buffer.from(copy));
  return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height, format };
}

/** Longest side at most 1600 pixels (DP-11). */
export function targetSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= 1600) return { width, height };
  const scale = 1600 / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Nearest-neighbour-free bilinear resample in integer pixel maths. */
export function resample(img: DecodedPhoto, to: { width: number; height: number }): DecodedPhoto {
  if (to.width === img.width && to.height === img.height) return img;
  const src = img.data;
  const dst = new Uint8ClampedArray(to.width * to.height * 4);
  // Fixed-point stepping in 1/1024ths to avoid accumulating floating error.
  const stepX = Math.round((img.width * 1024) / to.width);
  const stepY = Math.round((img.height * 1024) / to.height);
  for (let y = 0; y < to.height; y++) {
    const sy0 = (y * stepY) >> 10;
    const sy1 = Math.min(img.height - 1, sy0 + 1);
    const fy = (y * stepY) & 1023;
    for (let x = 0; x < to.width; x++) {
      const sx0 = (x * stepX) >> 10;
      const sx1 = Math.min(img.width - 1, sx0 + 1);
      const fx = (x * stepX) & 1023;
      for (let c = 0; c < 4; c++) {
        const a = src[(sy0 * img.width + sx0) * 4 + c]!;
        const b = src[(sy0 * img.width + sx1) * 4 + c]!;
        const d = src[(sy1 * img.width + sx0) * 4 + c]!;
        const e = src[(sy1 * img.width + sx1) * 4 + c]!;
        const top = a + (((b - a) * fx) >> 10);
        const bottom = d + (((e - d) * fx) >> 10);
        dst[(y * to.width + x) * 4 + c] = top + (((bottom - top) * fy) >> 10);
      }
    }
  }
  return { data: dst, width: to.width, height: to.height, format: img.format };
}

/** Encode a clean public copy in the original's format, with no metadata blocks. */
export async function encodeClean(img: DecodedPhoto): Promise<Uint8Array> {
  if (img.format === 'jpeg') {
    await loadJpeg();
    const buf = await jpegEncode!({ data: img.data, width: img.width, height: img.height });
    return new Uint8Array(buf);
  }
  if (img.format === 'png') {
    const { PNG } = await import('pngjs');
    const png = new PNG({ width: img.width, height: img.height });
    png.data = Buffer.from(img.data);
    return new Uint8Array(PNG.sync.write(png));
  }
  await loadWebp();
  const buf = await webpEncode!({ data: img.data, width: img.width, height: img.height }, { quality: 80 });
  return new Uint8Array(buf);
}
