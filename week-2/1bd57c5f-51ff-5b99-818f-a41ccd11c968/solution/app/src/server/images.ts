import { fail } from "./errors";

// Image intake: the type is judged by content, never by name or declared type, and every
// embedded metadata block (EXIF, XMP, IPTC, comments and PNG text chunks) is removed
// before the bytes are stored, so no location or camera data survives.

const IMAGE_LIMIT = 10_000_000;

export interface CleanImage {
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  ext: "jpg" | "png" | "webp";
}

class Malformed extends Error {}

function u16(data: Uint8Array, at: number): number {
  if (at + 2 > data.length) throw new Malformed();
  return (data[at]! << 8) | data[at + 1]!;
}

function u32be(data: Uint8Array, at: number): number {
  if (at + 4 > data.length) throw new Malformed();
  return ((data[at]! << 24) >>> 0) + (data[at + 1]! << 16) + (data[at + 2]! << 8) + data[at + 3]!;
}

function u32le(data: Uint8Array, at: number): number {
  if (at + 4 > data.length) throw new Malformed();
  return data[at]! + (data[at + 1]! << 8) + (data[at + 2]! << 16) + ((data[at + 3]! << 24) >>> 0);
}

function ascii(data: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...data.subarray(at, at + length));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_METADATA = new Set(["tEXt", "iTXt", "zTXt", "eXIf", "tIME"]);

function cleanPng(data: Uint8Array): Uint8Array {
  const parts = [data.subarray(0, 8)];
  let at = 8;
  let first = true;
  for (;;) {
    const length = u32be(data, at);
    const type = ascii(data, at + 4, 4);
    const end = at + 12 + length;
    if (end > data.length || (first && type !== "IHDR")) throw new Malformed();
    first = false;
    if (!PNG_METADATA.has(type)) parts.push(data.subarray(at, end));
    at = end;
    if (type === "IEND") return concat(parts);
  }
}

// JPEG segments kept: APP0 (JFIF), APP2 (ICC colour profile), APP14 (Adobe colour transform).
const JPEG_KEPT_APP = new Set([0xe0, 0xe2, 0xee]);

function cleanJpeg(data: Uint8Array): Uint8Array {
  const parts = [data.subarray(0, 2)];
  let at = 2;
  for (;;) {
    if (data[at] !== 0xff) throw new Malformed();
    while (data[at + 1] === 0xff) at += 1;
    const marker = data[at + 1];
    if (marker === undefined) throw new Malformed();
    if (marker === 0xd9) {
      parts.push(data.subarray(at, at + 2));
      return concat(parts);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(data.subarray(at, at + 2));
      at += 2;
      continue;
    }
    const end = at + 2 + u16(data, at + 2);
    if (end > data.length) throw new Malformed();
    if (marker === 0xda) {
      parts.push(data.subarray(at));
      return concat(parts);
    }
    const metadata = (marker >= 0xe0 && marker <= 0xef && !JPEG_KEPT_APP.has(marker)) || marker === 0xfe;
    if (!metadata) parts.push(data.subarray(at, end));
    at = end;
  }
}

function cleanWebp(data: Uint8Array): Uint8Array {
  if (u32le(data, 4) + 8 > data.length) throw new Malformed();
  const chunks: Uint8Array[] = [];
  let at = 12;
  const end = 8 + u32le(data, 4);
  while (at < end) {
    const type = ascii(data, at, 4);
    const size = u32le(data, at + 4);
    const next = at + 8 + size + (size % 2);
    if (next > end + 1) throw new Malformed();
    if (type === "VP8X") {
      const chunk = data.slice(at, Math.min(next, data.length));
      chunk[8] = chunk[8]! & ~0x0c;
      chunks.push(chunk);
    } else if (type !== "EXIF" && type !== "XMP ") {
      chunks.push(data.subarray(at, Math.min(next, data.length)));
    }
    at = next;
  }
  if (chunks.length === 0) throw new Malformed();
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set(data.subarray(0, 4), 0);
  new DataView(header.buffer).setUint32(4, body.length + 4, true);
  header.set(data.subarray(8, 12), 8);
  return concat([header, body]);
}

/** Checks the size, detects the type from the bytes and strips metadata, or refuses. */
export function cleanImage(data: Uint8Array): CleanImage {
  if (data.length > IMAGE_LIMIT) fail("photo_too_large");
  try {
    if (data.length > 8 && PNG_SIGNATURE.every((byte, index) => data[index] === byte)) {
      return { bytes: cleanPng(data), contentType: "image/png", ext: "png" };
    }
    if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
      return { bytes: cleanJpeg(data), contentType: "image/jpeg", ext: "jpg" };
    }
    if (data.length > 16 && ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 4) === "WEBP") {
      return { bytes: cleanWebp(data), contentType: "image/webp", ext: "webp" };
    }
  } catch (error) {
    if (!(error instanceof Malformed)) throw error;
  }
  fail("unsupported_image");
}

/** The file part of a multipart upload, as bytes. */
export async function uploadedBytes(form: FormData): Promise<Uint8Array | null> {
  const file = form.get("file");
  if (!(file instanceof Blob)) return null;
  return new Uint8Array(await file.arrayBuffer());
}
