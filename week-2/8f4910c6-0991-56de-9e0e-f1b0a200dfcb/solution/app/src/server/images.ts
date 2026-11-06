// Photo processing: decode by content (JPEG, PNG, WebP), apply the camera orientation, drop every piece of
// metadata (the re-encoded JPEG carries none), scale the longer side to at most 2,400 pixels.

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import decodeWebp, { init as initWebp } from "@jsquash/webp/decode.js";

const MAX_SIDE = 2400;
export const NOT_A_PHOTO = "That file is not a JPEG, PNG or WebP photo.";

interface Raster {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Uint8Array;
}

export interface Photo {
  jpeg: Buffer;
  width: number;
  height: number;
}

type Kind = "jpeg" | "png" | "webp";

function kindOf(data: Buffer): Kind | null {
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (data.length > 12 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP") {
    return "webp";
  }
  return null;
}

let webpReady: Promise<void> | null = null;

async function webp(data: Buffer): Promise<Raster> {
  webpReady ??= (async () => {
    const wasmPath = createRequire(import.meta.url).resolve("@jsquash/webp/codec/dec/webp_dec.wasm");
    await initWebp(await WebAssembly.compile(await readFile(wasmPath)));
  })();
  await webpReady;
  const copy = new Uint8Array(data);
  const image = await decodeWebp(copy.buffer);
  return { width: image.width, height: image.height, data: new Uint8Array(image.data.buffer) };
}

async function decode(kind: Kind, data: Buffer): Promise<Raster> {
  if (kind === "jpeg") {
    const image = jpeg.decode(data, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
    return { width: image.width, height: image.height, data: image.data };
  }
  if (kind === "png") {
    const image = PNG.sync.read(data);
    return { width: image.width, height: image.height, data: new Uint8Array(image.data) };
  }
  return webp(data);
}

/** The EXIF orientation (1–8) of a JPEG or WebP, 1 when absent. */
function orientationOf(kind: Kind, data: Buffer): number {
  let tiff: Buffer | null = null;
  if (kind === "jpeg") {
    let offset = 2;
    while (offset + 4 < data.length && data[offset] === 0xff) {
      const marker = data[offset + 1];
      const length = data.readUInt16BE(offset + 2);
      if (marker === 0xe1 && data.toString("latin1", offset + 4, offset + 10) === "Exif\0\0") {
        tiff = data.subarray(offset + 10, offset + 2 + length);
        break;
      }
      if (marker === 0xda) break;
      offset += 2 + length;
    }
  } else if (kind === "webp") {
    const at = data.indexOf("EXIF", 12, "latin1");
    if (at !== -1) {
      const chunk = data.subarray(at + 8, at + 8 + data.readUInt32LE(at + 4));
      tiff = chunk.toString("latin1", 0, 6) === "Exif\0\0" ? chunk.subarray(6) : chunk;
    }
  }
  if (!tiff || tiff.length < 8) return 1;
  const little = tiff.toString("latin1", 0, 2) === "II";
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return 1;
  for (let i = 0; i < u16(ifd); i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return 1;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

function orient(source: Raster, orientation: number): Raster {
  if (orientation === 1) return source;
  const { width: w, height: h, data } = source;
  const swap = orientation >= 5;
  const width = swap ? h : w;
  const height = swap ? w : h;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sx: number;
      let sy: number;
      switch (orientation) {
        case 2: sx = w - 1 - x; sy = y; break;
        case 3: sx = w - 1 - x; sy = h - 1 - y; break;
        case 4: sx = x; sy = h - 1 - y; break;
        case 5: sx = y; sy = x; break;
        case 6: sx = y; sy = h - 1 - x; break;
        case 7: sx = w - 1 - y; sy = h - 1 - x; break;
        default: sx = w - 1 - y; sy = x; break;
      }
      const from = (sy * w + sx) * 4;
      const to = (y * width + x) * 4;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
      out[to + 3] = data[from + 3];
    }
  }
  return { width, height, data: out };
}

/** Area-average downscale so the longer side is at most MAX_SIDE. */
function fit(source: Raster): Raster {
  const longer = Math.max(source.width, source.height);
  if (longer <= MAX_SIDE) return source;
  const width = Math.max(1, Math.round((source.width * MAX_SIDE) / longer));
  const height = Math.max(1, Math.round((source.height * MAX_SIDE) / longer));
  const out = new Uint8Array(width * height * 4);
  const sums = new Float64Array(width * height * 4);
  const counts = new Float64Array(width * height);
  for (let y = 0; y < source.height; y++) {
    const ty = Math.min(height - 1, Math.floor((y * height) / source.height));
    for (let x = 0; x < source.width; x++) {
      const tx = Math.min(width - 1, Math.floor((x * width) / source.width));
      const from = (y * source.width + x) * 4;
      const cell = ty * width + tx;
      sums[cell * 4] += source.data[from];
      sums[cell * 4 + 1] += source.data[from + 1];
      sums[cell * 4 + 2] += source.data[from + 2];
      sums[cell * 4 + 3] += source.data[from + 3];
      counts[cell] += 1;
    }
  }
  for (let cell = 0; cell < width * height; cell++) {
    for (let c = 0; c < 4; c++) out[cell * 4 + c] = Math.round(sums[cell * 4 + c] / counts[cell]);
  }
  return { width, height, data: out };
}

/** Transparent pixels land on white, since JPEG has no alpha. */
function flatten(raster: Raster): Raster {
  const { data } = raster;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 255) {
      for (let c = 0; c < 3; c++) data[i + c] = Math.round((data[i + c] * alpha + 255 * (255 - alpha)) / 255);
      data[i + 3] = 255;
    }
  }
  return raster;
}

/** Decodes by content; null when the bytes are not a JPEG, PNG or WebP picture. */
export async function processPhoto(data: Buffer): Promise<Photo | null> {
  const kind = kindOf(data);
  if (!kind) return null;
  let raster: Raster;
  try {
    raster = await decode(kind, data);
  } catch {
    return null;
  }
  if (!raster.width || !raster.height) return null;
  const finished = flatten(fit(orient(raster, orientationOf(kind, data))));
  const encoded = jpeg.encode({ width: finished.width, height: finished.height, data: finished.data }, 88);
  return { jpeg: Buffer.from(encoded.data), width: finished.width, height: finished.height };
}
