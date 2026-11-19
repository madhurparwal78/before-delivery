// Upload hygiene (brief: Business rules > Upload hygiene): type from leading bytes, metadata removal
// without re-encoding. Everything not removed is kept byte for byte, in its original order.

export type MediaType =
  | { kind: "image"; contentType: "image/jpeg"; ext: "jpg" }
  | { kind: "image"; contentType: "image/png"; ext: "png" }
  | { kind: "image"; contentType: "image/webp"; ext: "webp" }
  | { kind: "clip"; contentType: "video/mp4"; ext: "mp4" }
  | { kind: "clip"; contentType: "video/webm"; ext: "webm" };

const PNG: MediaType = { kind: "image", contentType: "image/png", ext: "png" };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sniff(data: Buffer): MediaType | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { kind: "image", contentType: "image/jpeg", ext: "jpg" };
  }
  if (data.subarray(0, 8).equals(PNG_SIGNATURE)) return PNG;
  if (data.length >= 12 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP") {
    return { kind: "image", contentType: "image/webp", ext: "webp" };
  }
  if (data.length >= 8 && data.toString("latin1", 4, 8) === "ftyp") {
    return { kind: "clip", contentType: "video/mp4", ext: "mp4" };
  }
  if (data.length >= 4 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
    return { kind: "clip", contentType: "video/webm", ext: "webm" };
  }
  return null;
}

/** Bytes limits per type (brief: Server boundary > Size limits). */
export const IMAGE_LIMIT = 15_000_000;
export const CLIP_LIMIT = 60_000_000;
export const STILL_LIMIT = 8_000_000;

const JPEG_DROPPED = new Set([0xe1, 0xed, 0xfe]); // APP1 (Exif, XMP), APP13 (IPTC, Photoshop), COM
const PNG_DROPPED = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);
const WEBP_DROPPED = new Set(["EXIF", "XMP "]);
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

function stripJpeg(data: Buffer): Buffer | null {
  const kept: Buffer[] = [data.subarray(0, 2)];
  let at = 2;
  while (at + 4 <= data.length) {
    if (data[at] !== 0xff) return null;
    const marker = data[at + 1] ?? 0;
    if (marker === 0xff) {
      kept.push(data.subarray(at, at + 1));
      at += 1;
      continue;
    }
    if (marker === 0xda) {
      kept.push(data.subarray(at));
      return Buffer.concat(kept);
    }
    const length = data.readUInt16BE(at + 2);
    if (length < 2 || at + 2 + length > data.length) return null;
    if (!JPEG_DROPPED.has(marker)) kept.push(data.subarray(at, at + 2 + length));
    at += 2 + length;
  }
  return null;
}

function stripPng(data: Buffer): Buffer | null {
  const kept: Buffer[] = [data.subarray(0, 8)];
  let at = 8;
  while (at + 12 <= data.length) {
    const length = data.readUInt32BE(at);
    const type = data.toString("latin1", at + 4, at + 8);
    const end = at + 12 + length;
    if (end > data.length) return null;
    if (!PNG_DROPPED.has(type)) kept.push(data.subarray(at, end));
    at = end;
    if (type === "IEND") return Buffer.concat(kept);
  }
  return null;
}

function stripWebp(data: Buffer): Buffer | null {
  const kept: Buffer[] = [];
  let at = 12;
  let vp8x: Buffer | null = null;
  while (at + 8 <= data.length) {
    const type = data.toString("latin1", at, at + 4);
    const size = data.readUInt32LE(at + 4);
    const end = at + 8 + size + (size % 2);
    if (at + 8 + size > data.length) return null;
    const chunk = Buffer.from(data.subarray(at, Math.min(end, data.length)));
    if (type === "VP8X") vp8x = chunk;
    if (!WEBP_DROPPED.has(type)) kept.push(chunk);
    at = end;
  }
  if (vp8x && vp8x.length > 8) vp8x[8] = (vp8x[8] ?? 0) & ~(VP8X_EXIF | VP8X_XMP);
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), ...kept]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/** Removes embedded metadata from an image; clips are returned unchanged. Null when the structure is broken. */
export function removeMetadata(data: Buffer, type: MediaType): Buffer | null {
  switch (type.contentType) {
    case "image/jpeg":
      return stripJpeg(data);
    case "image/png":
      return stripPng(data);
    case "image/webp":
      return stripWebp(data);
    case "video/mp4":
    case "video/webm":
      return data;
  }
}
