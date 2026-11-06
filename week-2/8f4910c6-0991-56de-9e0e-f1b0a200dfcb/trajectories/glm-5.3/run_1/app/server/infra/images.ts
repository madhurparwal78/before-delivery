import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

/**
 * Image decoding and encoding through local WebAssembly codecs
 * (MozJPEG, libpng-style Squoosh codec, libwebp). Every photo is
 * decoded, oriented, resized and re-encoded, so no metadata survives.
 */

const require2 = createRequire(import.meta.url);

interface ImageData {
  width: number;
  height: number;
  data: Uint8Array;
}

type Decoder = (input: Uint8Array) => Promise<ImageData>;
type Encoder = (image: ImageData, quality?: number) => Promise<Uint8Array>;

function loadWasm(modulePath: string): WebAssembly.Module {
  const resolved = require2.resolve(modulePath);
  return new WebAssembly.Module(readFileSync(resolved));
}

let jpegDecode: Decoder | null = null;
let jpegEncode: Encoder | null = null;
let pngDecode: Decoder | null = null;
let webpDecode: Decoder | null = null;

async function getJpegDecode(): Promise<Decoder> {
  if (!jpegDecode) {
    const mod = await import("@jsquash/jpeg/decode.js");
    const wasm = loadWasm("@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm");
    await mod.init(wasm);
    const decodeFn = mod.default as unknown as (input: Uint8Array, options: Record<string, unknown>) => Promise<ImageData>;
    jpegDecode = async (input) => decodeFn(input, { preserveOrientation: true });
  }
  return jpegDecode;
}

async function getJpegEncode(): Promise<Encoder> {
  if (!jpegEncode) {
    const mod = await import("@jsquash/jpeg/encode.js");
    const wasm = loadWasm("@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm");
    await mod.init(wasm);
    const encodeFn = mod.default as unknown as (image: ImageData, options: Record<string, unknown>) => Promise<ArrayBuffer>;
    jpegEncode = async (image, quality) => new Uint8Array(await encodeFn(image, { quality: quality ?? 82 }));
    void wasm;
  }
  return jpegEncode;
}

async function getPngDecode(): Promise<Decoder> {
  if (!pngDecode) {
    const mod = await import("@jsquash/png/decode.js");
    const wasm = loadWasm("@jsquash/png/codec/pkg/squoosh_png_bg.wasm");
    await mod.init(wasm);
    const decodeFn = mod.default as unknown as (input: Uint8Array) => Promise<ImageData>;
    pngDecode = async (input) => decodeFn(input);
    void wasm;
  }
  return pngDecode;
}

async function getWebpDecode(): Promise<Decoder> {
  if (!webpDecode) {
    const mod = await import("@jsquash/webp/decode.js");
    const wasm = loadWasm("@jsquash/webp/codec/dec/webp_dec.wasm");
    await mod.init(wasm);
    const decodeFn = mod.default as unknown as (input: Uint8Array) => Promise<ImageData>;
    webpDecode = async (input) => decodeFn(input);
    void wasm;
  }
  return webpDecode;
}

const JPEG_MAGIC = [0xff, 0xd8, 0xff];

/** Sniffs the container by its leading bytes. */
export function sniff(buffer: Buffer): "jpeg" | "png" | "webp" | null {
  if (buffer.length < 12) return null;
  if (JPEG_MAGIC.every((b, i) => buffer[i] === b)) return "jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "png";
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return "webp";
  return null;
}

/** Decodes a photo into raw RGBA pixels, applying the camera orientation. */
export async function decodePhoto(buffer: Buffer): Promise<ImageData | null> {
  const kind = sniff(buffer);
  if (!kind) return null;
  try {
    let decoded: ImageData;
    if (kind === "jpeg") {
      const decodeFn = (await getJpegDecode()) as unknown as (input: Uint8Array, options: Record<string, unknown>) => Promise<ImageData>;
      decoded = await decodeFn(new Uint8Array(buffer), { preserveOrientation: true });
      const orientation = jpegOrientation(buffer);
      if (orientation && orientation > 1) return orient(decoded, orientation);
      return decoded;
    }
    if (kind === "png") decoded = await (await getPngDecode())(new Uint8Array(buffer));
    else decoded = await (await getWebpDecode())(new Uint8Array(buffer));
    return decoded;
  } catch {
    return null;
  }
}

/** Reads the EXIF orientation tag from a JPEG's APP1 segment. */
export function jpegOrientation(buffer: Buffer): number | null {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    const marker = buffer[offset];
    if (marker !== 0xff) return null;
    const tag = buffer[offset + 1];
    const size = (buffer[offset + 2] << 8) | buffer[offset + 3];
    if (tag === 0xe1) {
      const exif = buffer.subarray(offset + 4, offset + 4 + size);
      if (exif.length >= 14 && exif[0] === 0x45 && exif[1] === 0x78 && exif[2] === 0x69 && exif[3] === 0x66) {
        return readOrientationFromTiff(exif.subarray(6));
      }
      return null;
    }
    if (tag === 0xda || tag === 0xd9) return null;
    offset += 2 + size;
  }
  return null;
}

function readOrientationFromTiff(tiff: Buffer): number | null {
  if (tiff.length < 8) return null;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const read16 = (o: number): number => (little ? (tiff[o] | (tiff[o + 1] << 8)) : ((tiff[o] << 8) | tiff[o + 1]));
  const read32 = (o: number): number => little
    ? (tiff[o] | (tiff[o + 1] << 8) | (tiff[o + 2] << 16) | (tiff[o + 3] << 24)) >>> 0
    : (((tiff[o] << 24) | (tiff[o + 1] << 16) | (tiff[o + 2] << 8) | tiff[o + 3]) >>> 0);
  if (read16(2) !== 0x2a) return null;
  const ifdOffset = read32(4);
  if (ifdOffset + 2 > tiff.length) return null;
  const entries = read16(ifdOffset);
  for (let i = 0; i < entries; i += 1) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > tiff.length) return null;
    if (read16(entry) === 0x0112) {
      return read16(entry + 8);
    }
  }
  return null;
}

/** Applies an EXIF orientation transform to raw pixels. */
function orient(image: ImageData, orientation: number): ImageData {
  const { width, height, data } = image;
  const rotate = orientation >= 5;
  const outWidth = rotate ? height : width;
  const outHeight = rotate ? width : height;
  const out = new Uint8Array(outWidth * outHeight * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let nx = x;
      let ny = y;
      switch (orientation) {
        case 2: nx = width - 1 - x; break;
        case 3: nx = width - 1 - x; ny = height - 1 - y; break;
        case 4: ny = height - 1 - y; break;
        case 5: nx = y; ny = x; break;
        case 6: nx = height - 1 - y; ny = x; break;
        case 7: nx = height - 1 - y; ny = width - 1 - x; break;
        case 8: nx = y; ny = width - 1 - x; break;
        default: break;
      }
      const from = (y * width + x) * 4;
      const to = (ny * outWidth + nx) * 4;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
      out[to + 3] = data[from + 3];
    }
  }
  return { width: outWidth, height: outHeight, data: out };
}

/** Area-average downscale so the longer side is at most the limit. */
export function resize(image: ImageData, limit: number): ImageData {
  const { width, height, data } = image;
  const longest = Math.max(width, height);
  if (longest <= limit) return image;
  const scale = limit / longest;
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const out = new Uint8Array(outWidth * outHeight * 4);
  const boxX = width / outWidth;
  const boxY = height / outHeight;
  for (let y = 0; y < outHeight; y += 1) {
    const startY = Math.floor(y * boxY);
    const endY = Math.min(height, Math.ceil((y + 1) * boxY));
    for (let x = 0; x < outWidth; x += 1) {
      const startX = Math.floor(x * boxX);
      const endX = Math.min(width, Math.ceil((x + 1) * boxX));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = startY; sy < endY; sy += 1) {
        for (let sx = startX; sx < endX; sx += 1) {
          const from = (sy * width + sx) * 4;
          r += data[from];
          g += data[from + 1];
          b += data[from + 2];
          a += data[from + 3];
          count += 1;
        }
      }
      const to = (y * outWidth + x) * 4;
      out[to] = Math.round(r / count);
      out[to + 1] = Math.round(g / count);
      out[to + 2] = Math.round(b / count);
      out[to + 3] = Math.round(a / count);
    }
  }
  return { width: outWidth, height: outHeight, data: out };
}

/** Encodes raw pixels as a JPEG. */
export async function encodeJpeg(image: ImageData, quality: number): Promise<Buffer> {
  const encoder = await getJpegEncode();
  const bytes = await encoder(image, quality);
  return Buffer.from(bytes);
}

/** Generates a portrait illustration for seeded talent. */
export async function generatedPortrait(index: number): Promise<Buffer> {
  const width = 900;
  const height = 1200;
  const palettes: Array<[number, number, number, number, number, number]> = [
    [243, 236, 226, 122, 46, 42],
    [238, 240, 230, 46, 59, 74],
    [244, 233, 223, 138, 90, 46],
    [236, 239, 243, 58, 46, 74],
  ];
  const [bgR, bgG, bgB, fgR, fgG, fgB] = palettes[index % palettes.length];
  const data = new Uint8Array(width * height * 4);
  const headCx = width / 2;
  const headCy = height * 0.36;
  const headR = width * 0.22;
  const shoulderY = height * 0.62;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - headCx;
      const dy = y - headCy;
      const inHead = dx * dx + dy * dy <= headR * headR;
      const inBody = y >= shoulderY && Math.abs(x - width / 2) < width * 0.38 - (y - shoulderY) * 0.15;
      const edge = x < 14 || x >= width - 14 || y < 14 || y >= height - 14;
      const tint = inHead || inBody ? [fgR, fgG, fgB] : [bgR, bgG, bgB];
      const at = (y * width + x) * 4;
      data[at] = tint[0];
      data[at + 1] = tint[1];
      data[at + 2] = tint[2];
      data[at + 3] = edge ? Math.round((fgR + bgR) / 2) : 255;
    }
  }
  return encodeJpeg({ width, height, data }, 82);
}
