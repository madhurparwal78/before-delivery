// Condition photos judged by their bytes: JPEG, PNG or WebP that decodes, re-encoded as metadata-free JPEG.

import { readFile } from "node:fs/promises";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import decodeWebp, { init as initWebp } from "@jsquash/webp/decode.js";

type Format = "jpeg" | "png" | "webp";

const PHOTO_MAX_SIDE = 8_000;

function sniff(bytes: Buffer): Format | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.length > 30 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

/** Width and height as the file's own header states them, or null when the header is malformed. */
function headerSize(format: Format, bytes: Buffer): { width: number; height: number } | null {
  if (format === "png") {
    return bytes.toString("latin1", 12, 16) === "IHDR" ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : null;
  }
  if (format === "webp") {
    const chunk = bytes.toString("latin1", 12, 16);
    if (chunk === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = bytes.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
    return null;
  }
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const length = bytes.readUInt16BE(i + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: bytes.readUInt16BE(i + 7), height: bytes.readUInt16BE(i + 5) };
    }
    i += 2 + length;
  }
  return null;
}

let webpReady: Promise<void> | null = null;

async function decodeWebpPixels(bytes: Buffer): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  webpReady ??= readFile(new URL(import.meta.resolve("@jsquash/webp/codec/dec/webp_dec.wasm")))
    .then((wasmBinary) => initWebp({ wasmBinary }));
  await webpReady;
  return decodeWebp(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

type PhotoVerdict =
  | { kind: "accepted"; width: number; height: number; rgba: Uint8Array }
  | { kind: "unsupported" }
  | { kind: "dimensions" };

/** The content and dimension checks for one photo, in the published order. */
export async function judgePhoto(bytes: Buffer): Promise<PhotoVerdict> {
  const format = sniff(bytes);
  const size = format && headerSize(format, bytes);
  if (!format || !size || size.width === 0 || size.height === 0) return { kind: "unsupported" };
  if (size.width > PHOTO_MAX_SIDE || size.height > PHOTO_MAX_SIDE) return { kind: "dimensions" };
  try {
    if (format === "png") {
      const png = PNG.sync.read(bytes);
      return { kind: "accepted", width: png.width, height: png.height, rgba: png.data };
    }
    if (format === "jpeg") {
      const image = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 64, maxMemoryUsageInMB: 1024 });
      return { kind: "accepted", width: image.width, height: image.height, rgba: image.data };
    }
    const image = await decodeWebpPixels(bytes);
    return { kind: "accepted", width: image.width, height: image.height, rgba: new Uint8Array(image.data.buffer) };
  } catch {
    return { kind: "unsupported" };
  }
}

/** Re-encodes decoded pixels as a baseline JPEG with no metadata segments; transparency is laid on white. */
export function encodeJpeg(photo: { width: number; height: number; rgba: Uint8Array }): Buffer {
  const data = Buffer.from(photo.rgba);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 255) continue;
    for (let c = 0; c < 3; c++) data[i + c] = (data[i + c] * alpha + 255 * (255 - alpha) + 127) / 255 | 0;
    data[i + 3] = 255;
  }
  return Buffer.from(jpeg.encode({ data, width: photo.width, height: photo.height }, 86).data);
}
