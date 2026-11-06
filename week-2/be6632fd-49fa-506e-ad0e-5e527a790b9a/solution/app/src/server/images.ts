// Look images (brief: Business rules → Looks). An upload is judged by decoding its content; the stored file is
// re-encoded from the decoded pixels, turned upright, so no orientation tag, location or other metadata survives.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import decodeWebp, { init as initWebp } from "@jsquash/webp/decode.js";

interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
}

interface StoredImage {
  bytes: Buffer;
  width: number;
  height: number;
  contentType: "image/jpeg" | "image/png";
  extension: "jpg" | "png";
}

type ImageVerdict = { ok: true; image: StoredImage } | { ok: false; reason: "type" | "pixels" };

const MAX_SIDE = 12_000;
const MAX_PIXELS = 40_000_000;

let webpReady: Promise<void> | null = null;

function webp(): Promise<void> {
  webpReady ??= (async () => {
    const wasmPath = createRequire(import.meta.url).resolve("@jsquash/webp/codec/dec/webp_dec.wasm");
    await initWebp(await WebAssembly.compile(readFileSync(wasmPath)));
  })();
  return webpReady;
}

type Kind = "jpeg" | "png" | "webp";

function kindOf(data: Buffer): Kind | null {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  if (data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

/** Declared size from the header, so an oversized image is refused before it is decoded. */
function declaredSize(kind: Kind, data: Buffer): { width: number; height: number } | null {
  if (kind === "png") return data.length >= 24 ? { width: data.readUInt32BE(16), height: data.readUInt32BE(20) } : null;
  if (kind === "webp") {
    const chunk = data.subarray(12, 16).toString("latin1");
    if (chunk === "VP8X" && data.length >= 30) return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
    if (chunk === "VP8 " && data.length >= 30) return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L" && data.length >= 25) {
      const bits = data.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  for (let i = 2; i + 9 < data.length; ) {
    if (data[i] !== 0xff) return null;
    const marker = data[i + 1];
    const length = data.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: data.readUInt16BE(i + 7), height: data.readUInt16BE(i + 5) };
    }
    i += 2 + length;
  }
  return null;
}

/** EXIF orientation (1 to 8) from a TIFF block, 1 when absent. */
function tiffOrientation(tiff: Buffer): number {
  if (tiff.length < 8) return 1;
  const little = tiff.subarray(0, 2).toString("latin1") === "II";
  const u16 = (at: number): number => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number): number => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return 1;
  const count = u16(ifd);
  for (let n = 0; n < count; n += 1) {
    const at = ifd + 2 + n * 12;
    if (at + 12 > tiff.length) return 1;
    if (u16(at) === 0x0112) {
      const value = u16(at + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

function orientationOf(kind: Kind, data: Buffer): number {
  if (kind === "jpeg") {
    for (let i = 2; i + 4 < data.length; ) {
      if (data[i] !== 0xff) return 1;
      const marker = data[i + 1];
      if (marker === 0xda) return 1;
      const length = data.readUInt16BE(i + 2);
      if (marker === 0xe1 && data.subarray(i + 4, i + 10).toString("latin1") === "Exif\0\0") return tiffOrientation(data.subarray(i + 10, i + 2 + length));
      i += 2 + length;
    }
    return 1;
  }
  const tag = kind === "png" ? "eXIf" : "EXIF";
  const at = data.indexOf(tag, kind === "png" ? 8 : 12, "latin1");
  if (at < 0) return 1;
  const length = kind === "png" ? data.readUInt32BE(at - 4) : data.readUInt32LE(at + 4);
  const start = kind === "png" ? at + 4 : at + 8;
  const block = data.subarray(start, start + length);
  return tiffOrientation(block.subarray(0, 6).toString("latin1") === "Exif\0\0" ? block.subarray(6) : block);
}

/** Applies an EXIF orientation to RGBA pixels. */
function upright(source: Pixels, orientation: number): Pixels {
  if (orientation === 1) return source;
  const { width: w, height: h, data } = source;
  const swap = orientation >= 5;
  const width = swap ? h : w;
  const height = swap ? w : h;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [tx, ty] = (
        {
          2: [w - 1 - x, y],
          3: [w - 1 - x, h - 1 - y],
          4: [x, h - 1 - y],
          5: [y, x],
          6: [h - 1 - y, x],
          7: [h - 1 - y, w - 1 - x],
          8: [y, w - 1 - x],
        } as Record<number, [number, number]>
      )[orientation];
      out.set(data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (ty * width + tx) * 4);
    }
  }
  return { width, height, data: out };
}

export function encodePng(pixels: Pixels): Buffer {
  const png = new PNG({ width: pixels.width, height: pixels.height });
  png.data = Buffer.from(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength);
  return PNG.sync.write(png);
}

async function decode(kind: Kind, data: Buffer): Promise<Pixels> {
  if (kind === "png") {
    const png = PNG.sync.read(data);
    return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
  }
  if (kind === "jpeg") {
    const decoded = jpeg.decode(data, { useTArray: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 1024, formatAsRGBA: true });
    return { width: decoded.width, height: decoded.height, data: decoded.data };
  }
  await webp();
  const decoded = await decodeWebp(data);
  return { width: decoded.width, height: decoded.height, data: new Uint8Array(decoded.data.buffer) };
}

export async function normaliseImage(data: Buffer): Promise<ImageVerdict> {
  const kind = kindOf(data);
  const size = kind ? declaredSize(kind, data) : null;
  if (!kind || !size || !size.width || !size.height) return { ok: false, reason: "type" };
  if (size.width > MAX_SIDE || size.height > MAX_SIDE || size.width * size.height > MAX_PIXELS) return { ok: false, reason: "pixels" };
  let pixels: Pixels;
  try {
    pixels = upright(await decode(kind, data), orientationOf(kind, data));
  } catch {
    return { ok: false, reason: "type" };
  }
  if (kind === "jpeg") {
    const bytes = jpeg.encode({ width: pixels.width, height: pixels.height, data: Buffer.from(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength) }, 90).data;
    return { ok: true, image: { bytes, width: pixels.width, height: pixels.height, contentType: "image/jpeg", extension: "jpg" } };
  }
  return { ok: true, image: { bytes: encodePng(pixels), width: pixels.width, height: pixels.height, contentType: "image/png", extension: "png" } };
}

/** The widths a page asks for (`?w=`): a calendar cover and a lookbook card, each about twice its widest box. */
export const THUMB_WIDTHS = [160, 480];

/** A stored image scaled down to `width` by averaging the source pixels under each target pixel, in its own format. */
export async function thumbnail(data: Buffer, width: number): Promise<Buffer> {
  const kind = kindOf(data);
  if (!kind) return data;
  const source = await decode(kind, data);
  if (source.width <= width) return data;
  const height = Math.max(1, Math.round((source.height * width) / source.width));
  const out = new Uint8Array(width * height * 4);
  const sx = source.width / width;
  const sy = source.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      const sum = [0, 0, 0, 0];
      for (let v = y0; v < y1; v++) {
        for (let u = x0; u < x1; u++) {
          const i = (v * source.width + u) * 4;
          for (let c = 0; c < 4; c++) sum[c] += source.data[i + c];
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = Math.round(sum[c] / n);
    }
  }
  const pixels = { width, height, data: out };
  if (kind === "jpeg") return jpeg.encode({ width, height, data: Buffer.from(out.buffer) }, 85).data;
  return encodePng(pixels);
}
