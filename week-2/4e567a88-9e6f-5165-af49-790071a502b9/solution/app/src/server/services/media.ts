// Media bytes: deterministic placeholder outputs, image type sniffing, and image URL fetching under the
// outbound rules (every redirect hop re-checked, at most 3 hops, 10 seconds in all).

import { promisify } from "node:util";
import { deflate, crc32 } from "node:zlib";
import type { ImageType } from "../http";
import { sniffImage, UPLOAD_LIMIT } from "../http";
import { checkAddress, pinnedRequest, Refused } from "./outbound";

const deflateAsync = promisify(deflate);

export const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/webm": "webm",
  "audio/wav": "wav",
};

// ---- sniffing ----------------------------------------------------------------------------------

interface Size {
  width: number | null;
  height: number | null;
}

function jpegSize(bytes: Buffer): Size {
  let at = 2;
  while (at + 9 < bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    const length = bytes.readUInt16BE(at + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    at += 2 + length;
  }
  return { width: null, height: null };
}

function webpSize(bytes: Buffer): Size {
  const chunk = bytes.toString("latin1", 12, 16);
  if (chunk === "VP8X" && bytes.length >= 30) {
    return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  }
  if (chunk === "VP8L" && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  return { width: null, height: null };
}

export function imageSize(type: ImageType, bytes: Buffer): Size {
  if (type === "image/png") {
    return bytes.length >= 24 ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : { width: null, height: null };
  }
  return type === "image/jpeg" ? jpegSize(bytes) : webpSize(bytes);
}

// ---- image URL inputs ---------------------------------------------------------------------------

export const FIELD_COPY = {
  refused: "This address is not allowed. Use a public address.",
  unfetchable: "That image could not be fetched.",
  notImage: "That address did not return a PNG, JPEG or WebP image.",
  tooLarge: "That image is larger than the upload limit.",
} as const;

export class FetchRefused extends Error {
  constructor(readonly copy: string) {
    super(copy);
  }
}

const MAX_REDIRECTS = 3;
const FETCH_MS = 10_000;

/** Checks an address before anything is sent; throws FetchRefused with the refusal copy. */
export async function checkImageAddress(text: string): Promise<void> {
  try {
    await checkAddress(text);
  } catch (error) {
    if (error instanceof Refused) throw new FetchRefused(FIELD_COPY.refused);
    throw error;
  }
}

/** Fetches an image URL, re-checking every redirect hop. */
export async function fetchImage(text: string): Promise<{ type: ImageType; bytes: Buffer }> {
  const deadline = Date.now() + FETCH_MS;
  let next = text;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let checked;
    try {
      checked = await checkAddress(next);
    } catch (error) {
      if (error instanceof Refused) throw new FetchRefused(FIELD_COPY.refused);
      throw error;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new FetchRefused(FIELD_COPY.unfetchable);
    let answer;
    try {
      answer = await pinnedRequest(checked, { method: "GET", timeoutMs: remaining, maxBytes: UPLOAD_LIMIT });
    } catch {
      throw new FetchRefused(FIELD_COPY.unfetchable);
    }
    if (answer.status >= 300 && answer.status < 400 && answer.location) {
      next = new URL(answer.location, checked.url).href;
      continue;
    }
    if (answer.tooLarge) throw new FetchRefused(FIELD_COPY.tooLarge);
    if (answer.status < 200 || answer.status >= 300) throw new FetchRefused(FIELD_COPY.unfetchable);
    const type = sniffImage(answer.body);
    if (!type) throw new FetchRefused(FIELD_COPY.notImage);
    return { type, bytes: answer.body };
  }
  throw new FetchRefused(FIELD_COPY.unfetchable);
}

// ---- placeholder outputs -----------------------------------------------------------------------

const PALETTES: ReadonlyArray<readonly [number[], number[]]> = [
  [[243, 238, 228], [14, 92, 87]],
  [[243, 238, 228], [196, 57, 29]],
  [[30, 28, 25], [214, 204, 187]],
  [[14, 92, 87], [196, 57, 29]],
  [[139, 128, 112], [243, 238, 228]],
];

function pngChunk(kind: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(kind, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** A PNG of exactly width × height: a diagonal blend chosen by the seed. Rows use the Sub filter. */
export async function placeholderPng(width: number, height: number, seed: number): Promise<Buffer> {
  const [from, to] = PALETTES[seed % PALETTES.length];
  const span = width + height;
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    raw[row] = 1;
    const previous = [0, 0, 0];
    for (let x = 0; x < width; x++) {
      const t = (x + y) / span;
      for (let c = 0; c < 3; c++) {
        const value = Math.round(from[c] + (to[c] - from[c]) * t);
        raw[row + 1 + x * 3 + c] = (value - previous[c]) & 0xff;
        previous[c] = value;
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", await deflateAsync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const WAV_RATE = 8_000;

/** An 8 kHz, 8-bit mono WAV of exactly `seconds` seconds: a soft 220 Hz tone. */
export function placeholderWav(seconds: number): Buffer {
  const samples = seconds * WAV_RATE;
  const out = Buffer.alloc(44 + samples);
  out.write("RIFF", 0, "latin1");
  out.writeUInt32LE(36 + samples, 4);
  out.write("WAVEfmt ", 8, "latin1");
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(WAV_RATE, 24);
  out.writeUInt32LE(WAV_RATE, 28);
  out.writeUInt16LE(1, 32);
  out.writeUInt16LE(8, 34);
  out.write("data", 36, "latin1");
  out.writeUInt32LE(samples, 40);
  for (let i = 0; i < samples; i++) out[44 + i] = 128 + Math.round(24 * Math.sin((2 * Math.PI * 220 * i) / WAV_RATE));
  return out;
}

function ebml(id: number[], data: Buffer): Buffer {
  const size = data.length;
  const length = Buffer.alloc(8);
  length.writeUInt8(0x01, 0);
  length.writeUIntBE(size, 2, 6);
  return Buffer.concat([Buffer.from(id), length, data]);
}

const uint = (value: number): Buffer => {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value, 0);
  return out;
};

/** A WebM container header for a 1280 × 720 clip of the given duration (the bytes need not play). */
export function placeholderWebm(durationSeconds: number): Buffer {
  const header = ebml([0x1a, 0x45, 0xdf, 0xa3], Buffer.concat([
    ebml([0x42, 0x86], uint(1)), ebml([0x42, 0xf7], uint(1)), ebml([0x42, 0xf2], uint(4)),
    ebml([0x42, 0xf3], uint(8)), ebml([0x42, 0x82], Buffer.from("webm")), ebml([0x42, 0x87], uint(4)),
    ebml([0x42, 0x85], uint(2)),
  ]));
  const duration = Buffer.alloc(8);
  duration.writeDoubleBE(durationSeconds * 1000, 0);
  const info = ebml([0x15, 0x49, 0xa9, 0x66], Buffer.concat([ebml([0x2a, 0xd7, 0xb1], uint(1_000_000)), ebml([0x44, 0x89], duration)]));
  const video = ebml([0xe0], Buffer.concat([ebml([0xb0], uint(1280)), ebml([0xba], uint(720))]));
  const track = ebml([0xae], Buffer.concat([ebml([0xd7], uint(1)), ebml([0x83], uint(1)), ebml([0x86], Buffer.from("V_VP9")), video]));
  const tracks = ebml([0x16, 0x54, 0xae, 0x6b], track);
  return Buffer.concat([header, ebml([0x18, 0x53, 0x80, 0x67], Buffer.concat([info, tracks]))]);
}
