import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { errors } from "../http/errors.js";

export type ImageType = "image/png" | "image/jpeg";

export interface DecodedImage {
  width: number;
  height: number;
  encode(type: ImageType): Buffer;
}

export const MAX_BYTES = 8_000_000;
export const MIN_DIMENSION = 640;
export const MAX_DIMENSION = 4096;
export const MAX_IMAGES_PER_ENTRY = 6;

function isPng(buf: Buffer): boolean {
  return buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
}

function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/**
 * The single place judging an uploaded image by its content, in the order the
 * brief requires: size, signature, full decode, dimensions.
 */
export function acceptImage(buf: Buffer): { type: ImageType; width: number; height: number; bytes: Buffer } {
  if (buf.length > MAX_BYTES) {
    throw errors.fileTooLarge();
  }
  const type: ImageType | null = isPng(buf) ? "image/png" : isJpeg(buf) ? "image/jpeg" : null;
  if (!type) {
    throw errors.unsupportedType();
  }
  let decoded: DecodedImage;
  try {
    decoded = decode(buf, type);
  } catch {
    throw errors.validation({ file: "This file isn't a readable PNG or JPEG image." });
  }
  if (decoded.width < MIN_DIMENSION || decoded.height < MIN_DIMENSION || decoded.width > MAX_DIMENSION || decoded.height > MAX_DIMENSION) {
    throw errors.validation({ file: "Images must be 640 to 4,096 pixels on each side." });
  }
  // Re-encode in the detected format, dropping all metadata and trailing bytes.
  const bytes = decoded.encode(type);
  return { type, width: decoded.width, height: decoded.height, bytes };
}

function decode(buf: Buffer, type: ImageType): DecodedImage {
  if (type === "image/png") {
    const png = PNG.sync.read(buf);
    return {
      width: png.width,
      height: png.height,
      encode: (t) => {
        const out = new PNG({ width: png.width, height: png.height });
        out.data = png.data;
        return t === "image/png" ? PNG.sync.write(out, {}) : Buffer.from(jpeg.encode({ data: png.data, width: png.width, height: png.height }, 85).data);
      },
    };
  }
  const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: false });
  return {
    width: img.width,
    height: img.height,
    encode: (t) => {
      if (t === "image/jpeg") {
        return Buffer.from(jpeg.encode({ data: img.data, width: img.width, height: img.height }, 85).data);
      }
      const png = new PNG({ width: img.width, height: img.height });
      // jpeg-js with formatAsRGBA:false gives RGB (3 bytes per pixel); PNG needs RGBA.
      const src = img.data as unknown as Uint8Array;
      const rgba = Buffer.alloc(png.width * png.height * 4);
      for (let i = 0; i < png.width * png.height; i++) {
        rgba[i * 4] = src[i * 3];
        rgba[i * 4 + 1] = src[i * 3 + 1];
        rgba[i * 4 + 2] = src[i * 3 + 2];
        rgba[i * 4 + 3] = 255;
      }
      png.data = rgba;
      return PNG.sync.write(png, {});
    },
  };
}

export function extensionFor(type: ImageType): string {
  return type === "image/png" ? "png" : "jpg";
}

/** The storage key for an entry image; never the uploaded file name. */
export function assetKey(entryId: string, assetId: string, type: ImageType): string {
  return `entries/${entryId}/${assetId}.${extensionFor(type)}`;
}

export function entryPrefix(entryId: string): string {
  return `entries/${entryId}/`;
}

export function juryPacketKey(roundId: string): string {
  return `rounds/${roundId}/jury-packet.json`;
}

/** Draws a decorative seed image: a two-tone composition keyed by a string seed. */
export function drawSeedImage(seed: string, width: number, height: number): Buffer {
  let hash = 2166136261;
  for (const ch of seed) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const rand = () => {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    return ((hash >>> 0) % 1000) / 1000;
  };
  const png = new PNG({ width, height });
  const paper = { r: 246, g: 242, b: 234 };
  const ink = { r: 26, g: 26, b: 24 };
  const cobalt = { r: 24, g: 82, b: 218 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      let base = paper;
      const band = Math.floor((x / width) * 6);
      const stripe = Math.floor((y / height) * 4);
      if ((band + stripe) % 7 === 0) {
        base = ink;
      } else if ((band * 2 + stripe) % 11 === 0) {
        base = cobalt;
      }
      const circle = (x - width / 2) ** 2 + (y - height / 2) ** 2;
      const inCircle = circle < (height / 3) ** 2;
      png.data[idx] = inCircle ? 255 - base.r : base.r;
      png.data[idx + 1] = inCircle ? 255 - base.g : base.g;
      png.data[idx + 2] = inCircle ? 255 - base.b : base.b;
      png.data[idx + 3] = 255;
    }
  }
  // Sprinkle deterministic "registration marks" so each seed looks different.
  for (let i = 0; i < 24; i++) {
    const cx = Math.floor(rand() * width);
    const cy = Math.floor(rand() * height);
    const size = 3 + Math.floor(rand() * 14);
    const dark = rand() > 0.5;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= width || y >= height) {
          continue;
        }
        const idx = (width * y + x) << 2;
        const c = dark ? ink : cobalt;
        png.data[idx] = c.r;
        png.data[idx + 1] = c.g;
        png.data[idx + 2] = c.b;
      }
    }
  }
  return PNG.sync.write(png, {});
}
