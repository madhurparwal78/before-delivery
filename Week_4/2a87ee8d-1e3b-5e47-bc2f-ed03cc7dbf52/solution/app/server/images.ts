// Image stickies: the type is judged by the bytes, the size by the header, and metadata is removed before storage.
import type { Db } from "./db.js";
import { ApiError, FIELD } from "./errors.js";
import { deleteObject, StorageDown } from "./storage.js";

type ImageType = "image/png" | "image/jpeg" | "image/webp";

const MAX_SIDE = 8000;

function sniff(bytes: Buffer): ImageType | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

interface Cleaned {
  bytes: Buffer;
  width: number;
  height: number;
}

const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt"]);

function cleanPng(bytes: Buffer): Cleaned | null {
  const kept: Buffer[] = [bytes.subarray(0, 8)];
  let width = 0;
  let height = 0;
  for (let i = 8; i + 12 <= bytes.length; ) {
    const length = bytes.readUInt32BE(i);
    const type = bytes.toString("latin1", i + 4, i + 8);
    const end = i + 12 + length;
    if (end > bytes.length) return null;
    if (type === "IHDR") {
      width = bytes.readUInt32BE(i + 8);
      height = bytes.readUInt32BE(i + 12);
    }
    if (!PNG_DROP.has(type)) kept.push(bytes.subarray(i, end));
    i = end;
    if (type === "IEND") break;
  }
  return width && height ? { bytes: Buffer.concat(kept), width, height } : null;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function cleanJpeg(bytes: Buffer): Cleaned | null {
  const kept: Buffer[] = [bytes.subarray(0, 2)];
  let width = 0;
  let height = 0;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1] ?? 0;
    if (marker === 0xd9) {
      kept.push(bytes.subarray(i, i + 2));
      i += 2;
      break;
    }
    const length = bytes.readUInt16BE(i + 2);
    const end = i + 2 + length;
    if (end > bytes.length) return null;
    if (SOF.has(marker)) {
      height = bytes.readUInt16BE(i + 5);
      width = bytes.readUInt16BE(i + 7);
    }
    const metadata = marker === 0xe1 || marker === 0xed;
    if (!metadata) kept.push(bytes.subarray(i, end));
    i = end;
    if (marker === 0xda) {
      kept.push(bytes.subarray(i));
      i = bytes.length;
    }
  }
  return width && height ? { bytes: Buffer.concat(kept), width, height } : null;
}

function cleanWebp(bytes: Buffer): Cleaned | null {
  const chunks: Buffer[] = [];
  let width = 0;
  let height = 0;
  for (let i = 12; i + 8 <= bytes.length; ) {
    const fourcc = bytes.toString("latin1", i, i + 4);
    const size = bytes.readUInt32LE(i + 4);
    const end = i + 8 + size + (size % 2);
    if (i + 8 + size > bytes.length) return null;
    const data = bytes.subarray(i + 8, i + 8 + size);
    if (fourcc === "VP8X" && data.length >= 10) {
      width = 1 + data.readUIntLE(4, 3);
      height = 1 + data.readUIntLE(7, 3);
    } else if (fourcc === "VP8 " && data.length >= 10 && !width) {
      width = data.readUInt16LE(6) & 0x3fff;
      height = data.readUInt16LE(8) & 0x3fff;
    } else if (fourcc === "VP8L" && data.length >= 5 && !width) {
      const bits = data.readUInt32LE(1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
    }
    if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      const chunk = Buffer.from(bytes.subarray(i, Math.min(end, bytes.length)));
      if (fourcc === "VP8X") chunk[8] = (chunk[8] ?? 0) & ~0x0c;
      chunks.push(chunk);
    }
    i = end;
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "latin1");
  return width && height ? { bytes: Buffer.concat([header, body]), width, height } : null;
}

/** Checks the declared type against the bytes, bounds the dimensions and strips location and camera metadata. */
export function cleanImage(bytes: Buffer, declared: string): Cleaned & { type: ImageType } {
  const type = sniff(bytes);
  if (type === null || type !== declared) throw new ApiError("unsupported_media_type");
  const cleaned = type === "image/png" ? cleanPng(bytes) : type === "image/jpeg" ? cleanJpeg(bytes) : cleanWebp(bytes);
  if (!cleaned) throw new ApiError("unsupported_media_type");
  if (cleaned.width > MAX_SIDE || cleaned.height > MAX_SIDE) throw new ApiError("validation", { fields: { image: FIELD.imageSide } });
  return { ...cleaned, type };
}

export function imageKey(workshopId: string, imageId: string): string {
  return `workshops/${workshopId}/images/${imageId}`;
}

/**
 * The image reference rule: an object is kept while a note (on the board or in a trashed frame not yet
 * purged) or a stored version uses it. When the last reference goes, the object is deleted, or queued
 * for deletion while storage is down.
 */
export async function releaseImage(t: Db, workshopId: string, imageId: string): Promise<void> {
  const used = await t.one(
    `SELECT 1 AS used FROM notes WHERE image_id = $1
     UNION ALL SELECT 1 FROM versions WHERE workshop_id = $2 AND snapshot->'notes' @> jsonb_build_array(jsonb_build_object('image_id', $1::text))
     LIMIT 1`,
    [imageId, workshopId],
  );
  if (used) return;
  await t.run("UPDATE images SET gone = true WHERE id = $1", [imageId]);
  try {
    await deleteObject(imageKey(workshopId, imageId));
  } catch (error) {
    if (!(error instanceof StorageDown)) throw error;
    await t.run("INSERT INTO image_deletions (image_id, workshop_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [imageId, workshopId]);
  }
}
