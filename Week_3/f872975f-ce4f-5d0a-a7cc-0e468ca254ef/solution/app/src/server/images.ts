// Photo checks and copies: signature, decode, pixel limit, EXIF orientation, upright display copy
// and a 320 px thumbnail, both re-encoded from the upright pixels with no metadata.
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

export type PhotoType = "image/jpeg" | "image/png";

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PIXEL_LIMIT = 40_000_000;
const THUMB_EDGE = 320;

export function hasSignature(bytes: Buffer, type: PhotoType): boolean {
  const signature = type === "image/jpeg" ? JPEG_SIGNATURE : PNG_SIGNATURE;
  return bytes.length >= signature.length && bytes.subarray(0, signature.length).equals(signature);
}

/** Pixel size from the header, before any decoding; null when the header is not readable. */
function headerSize(bytes: Buffer, type: PhotoType): { width: number; height: number } | null {
  if (type === "image/png") {
    if (bytes.length < 24 || bytes.toString("latin1", 12, 16) !== "IHDR") return null;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1] ?? 0;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = bytes.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

/** EXIF Orientation (1–8) from a JPEG's APP1 segment; anything missing or other counts as 1. */
function exifOrientation(bytes: Buffer): number {
  let i = 2;
  while (i + 4 < bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1] ?? 0;
    if (marker === 0xda || marker === 0xd9) break;
    const length = bytes.readUInt16BE(i + 2);
    if (marker === 0xe1 && bytes.toString("latin1", i + 4, i + 10) === "Exif\0\0") {
      const tiff = i + 10;
      const little = bytes.toString("latin1", tiff, tiff + 2) === "II";
      const u16 = (at: number): number => (little ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at));
      const u32 = (at: number): number => (little ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at));
      if (tiff + 8 > bytes.length) return 1;
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > bytes.length) return 1;
      const count = u16(ifd);
      for (let e = 0; e < count; e++) {
        const entry = ifd + 2 + e * 12;
        if (entry + 12 > bytes.length) return 1;
        if (u16(entry) === 0x0112) {
          const value = u16(entry + 8);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    i += 2 + length;
  }
  return 1;
}

interface Raster {
  width: number;
  height: number;
  data: Buffer; // RGBA
}

/** Applies an EXIF orientation so the pixels stand upright. */
function upright(src: Raster, orientation: number): Raster {
  if (orientation === 1) return src;
  const swap = orientation >= 5;
  const width = swap ? src.height : src.width;
  const height = swap ? src.width : src.height;
  const data = Buffer.alloc(width * height * 4);
  const W = src.width;
  const H = src.height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sx: number;
      let sy: number;
      switch (orientation) {
        case 2: sx = W - 1 - x; sy = y; break;
        case 3: sx = W - 1 - x; sy = H - 1 - y; break;
        case 4: sx = x; sy = H - 1 - y; break;
        case 5: sx = y; sy = x; break;
        case 6: sx = y; sy = H - 1 - x; break;
        case 7: sx = W - 1 - y; sy = H - 1 - x; break;
        default: sx = W - 1 - y; sy = x; break; // 8
      }
      src.data.copy(data, (y * width + x) * 4, (sy * W + sx) * 4, (sy * W + sx) * 4 + 4);
    }
  }
  return { width, height, data };
}

function thumbSize(width: number, height: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= THUMB_EDGE) return { width, height };
  const short = Math.max(1, Math.floor((Math.min(width, height) * THUMB_EDGE * 2 + long) / (2 * long)));
  return width >= height ? { width: THUMB_EDGE, height: short } : { width: short, height: THUMB_EDGE };
}

/** Area-average downscale (image scaling is the one place floating point is used). */
function shrink(src: Raster, width: number, height: number): Raster {
  if (width === src.width && height === src.height) return src;
  const data = Buffer.alloc(width * height * 4);
  const sx = src.width / width;
  const sy = src.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let p = (yy * src.width + x0) * 4;
        for (let xx = x0; xx < x1; xx++) {
          r += src.data[p] ?? 0; g += src.data[p + 1] ?? 0; b += src.data[p + 2] ?? 0; a += src.data[p + 3] ?? 0;
          n += 1;
          p += 4;
        }
      }
      const o = (y * width + x) * 4;
      data[o] = Math.round(r / n); data[o + 1] = Math.round(g / n); data[o + 2] = Math.round(b / n); data[o + 3] = Math.round(a / n);
    }
  }
  return { width, height, data };
}

function encode(raster: Raster, type: PhotoType): Buffer {
  if (type === "image/jpeg") return Buffer.from(jpeg.encode(raster, 90).data);
  const png = new PNG({ width: raster.width, height: raster.height });
  raster.data.copy(png.data);
  return PNG.sync.write(png, { deflateLevel: 6 });
}

interface PhotoCopies {
  display: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

/** Throws "photo" when the bytes do not decode or exceed the pixel limit. */
export function makeCopies(bytes: Buffer, type: PhotoType): PhotoCopies {
  const size = headerSize(bytes, type);
  if (size === null || size.width < 1 || size.height < 1) throw new Error("photo");
  if (size.width * size.height > PIXEL_LIMIT) throw new Error("photo");
  let decoded: Raster;
  try {
    if (type === "image/png") {
      const png = PNG.sync.read(bytes);
      decoded = { width: png.width, height: png.height, data: png.data };
    } else {
      const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 41, maxMemoryUsageInMB: 1024 });
      decoded = { width: img.width, height: img.height, data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength) };
    }
  } catch {
    throw new Error("photo");
  }
  const up = upright(decoded, type === "image/jpeg" ? exifOrientation(bytes) : 1);
  const t = thumbSize(up.width, up.height);
  return { display: encode(up, type), thumb: encode(shrink(up, t.width, t.height), type), width: up.width, height: up.height };
}
