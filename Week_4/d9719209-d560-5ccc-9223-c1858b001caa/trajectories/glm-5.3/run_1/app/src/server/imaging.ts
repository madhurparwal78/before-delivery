/* Image decoding and encoding without native bindings: JPEG and PNG decode
   in pure JS, WebP through the libwebp WASM build. The WASM modules are read
   from the package on disk and compiled once. Resize is a box-filter
   (area-average) resampler, which never upscales. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import encodeWebpApi, { init as initEncode } from '@jsquash/webp/encode.js';
import decodeWebpApi, { init as initDecode } from '@jsquash/webp/decode.js';
import { simd } from 'wasm-feature-detect';

export type Rgba = { width: number; height: number; data: Uint8Array };

const nodeRequire = createRequire(import.meta.url);
const CODEC_DIR = path.join(path.dirname(nodeRequire.resolve('@jsquash/webp/package.json')), 'codec');

let ready: Promise<void> | null = null;

async function warmUp(): Promise<void> {
  const hasSimd = await simd();
  const encFile = hasSimd ? 'enc/webp_enc_simd.wasm' : 'enc/webp_enc.wasm';
  const decFile = 'dec/webp_dec.wasm';
  const [encModule, decModule] = await Promise.all([
    WebAssembly.compile(fs.readFileSync(path.join(CODEC_DIR, encFile)).buffer as ArrayBuffer),
    WebAssembly.compile(fs.readFileSync(path.join(CODEC_DIR, decFile)).buffer as ArrayBuffer),
  ]);
  await Promise.all([initEncode(encModule), initDecode(decModule)]);
}

function webp(): Promise<void> {
  ready ??= warmUp();
  return ready;
}

/* Magic-byte sniffing: the only thing that decides whether a file is a JPEG,
   PNG or WebP, whatever its name or declared type. */
export type ImageKind = 'jpeg' | 'png' | 'webp';

export function sniff(buf: Buffer): ImageKind | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

/* EXIF orientation 1-8 is applied here, so no orientation metadata survives. */
export async function decode(buf: Buffer, kind: ImageKind): Promise<Rgba> {
  if (kind === 'jpeg') {
    const raw = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
    const orientation = jpegOrientation(buf);
    const img = { width: raw.width as number, height: raw.height as number, data: new Uint8Array(raw.data as Uint8Array) };
    return orientation <= 1 ? img : reorient(img, orientation);
  }
  if (kind === 'png') {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
  }
  await webp();
  const rgba = await decodeWebpApi(new Uint8Array(buf).buffer as ArrayBuffer);
  return { width: rgba.width, height: rgba.height, data: new Uint8Array(rgba.data) };
}

/* Area-average resampling: every destination pixel averages the source pixels
   it covers, so the image never gains detail and never upscales. */
export function resize(src: Rgba, targetWidth: number): Rgba {
  if (targetWidth >= src.width) return { width: src.width, height: src.height, data: src.data };
  const w = targetWidth;
  const h = Math.max(1, Math.round((src.height * targetWidth) / src.width));
  const out = new Uint8Array(w * h * 4);
  const xRatio = src.width / w;
  const yRatio = src.height / h;
  for (let dy = 0; dy < h; dy++) {
    const sy0 = Math.floor(dy * yRatio);
    const sy1 = Math.min(Math.floor((dy + 1) * yRatio), src.height);
    for (let dx = 0; dx < w; dx++) {
      const sx0 = Math.floor(dx * xRatio);
      const sx1 = Math.min(Math.floor((dx + 1) * xRatio), src.width);
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * src.width + sx) * 4;
          r += src.data[i] as number;
          g += src.data[i + 1] as number;
          b += src.data[i + 2] as number;
          a += src.data[i + 3] as number;
          count += 1;
        }
      }
      const o = (dy * w + dx) * 4;
      out[o] = count === 0 ? 0 : Math.round(r / count);
      out[o + 1] = count === 0 ? 0 : Math.round(g / count);
      out[o + 2] = count === 0 ? 0 : Math.round(b / count);
      out[o + 3] = count === 0 ? 255 : Math.round(a / count);
    }
  }
  return { width: w, height: h, data: out };
}

export async function encodeWebpFromRgba(img: Rgba, quality = 82): Promise<Uint8Array> {
  await webp();
  const bytes = await encodeWebpApi({ data: img.data, width: img.width, height: img.height }, { quality });
  return new Uint8Array(bytes);
}

/* The EXIF orientation value from a JPEG's APP1 block. */
function jpegOrientation(buf: Buffer): number {
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return 1;
    const marker = buf[i + 1] as number;
    const size = buf.readUInt16BE(i + 2);
    if (marker === 0xe1 && buf.subarray(i + 4, i + 10).toString('ascii') === 'Exif\u0000\u0000') {
      const tiff = i + 10;
      const endian = buf[tiff] === 0x49 ? 'LE' : 'BE';
      const ifdOffset = endian === 'LE' ? buf.readUInt32LE(tiff + 4) : buf.readUInt32BE(tiff + 4);
      const ifd = tiff + ifdOffset;
      const count = endian === 'LE' ? buf.readUInt16LE(ifd) : buf.readUInt16BE(ifd);
      for (let e = 0; e < count; e++) {
        const entry = ifd + 2 + e * 12;
        const tag = endian === 'LE' ? buf.readUInt16LE(entry) : buf.readUInt16BE(entry);
        if (tag === 0x0112) {
          const value = endian === 'LE' ? buf.readUInt16LE(entry + 8) : buf.readUInt16BE(entry + 8);
          return Math.min(8, Math.max(1, value));
        }
      }
      return 1;
    }
    i += 2 + size;
  }
  return 1;
}

/* Apply one of the eight EXIF orientations by permuting rows and columns. */
function reorient(img: Rgba, orientation: number): Rgba {
  const { width, height, data } = img;
  const flipDims = orientation >= 5;
  const outW = flipDims ? height : width;
  const outH = flipDims ? width : height;
  const out = new Uint8Array(outW * outH * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let ox = x;
      let oy = y;
      switch (orientation) {
        case 2: ox = width - 1 - x; break;
        case 3: ox = width - 1 - x; oy = height - 1 - y; break;
        case 4: oy = height - 1 - y; break;
        case 5: ox = y; oy = x; break;
        case 6: ox = y; oy = width - 1 - x; break;
        case 7: ox = height - 1 - y; oy = width - 1 - x; break;
        case 8: ox = height - 1 - y; oy = x; break;
        default: break;
      }
      const src = (y * width + x) * 4;
      const dst = (oy * outW + ox) * 4;
      out[dst] = data[src] as number;
      out[dst + 1] = data[src + 1] as number;
      out[dst + 2] = data[src + 2] as number;
      out[dst + 3] = data[src + 3] as number;
    }
  }
  return { width: outW, height: outH, data: out };
}
