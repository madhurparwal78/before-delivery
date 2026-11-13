import { randomUUID } from "node:crypto";
import { OUTAGE_COPY } from "../shared/copy.js";
import { PLATES } from "../shared/domain.js";
import { pool } from "./db.js";
import { fail } from "./http.js";
import { getObject, putObject, StorageUnreachable } from "./s3.js";

/** Plate art: PNG or JPEG judged by its leading bytes, within published size and pixel limits. */

const MAX_BYTES = 5000000;
const MAX_SIDE = 6000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface ArtFacts {
  contentType: "image/png" | "image/jpeg";
  extension: "png" | "jpg";
  width: number;
  height: number;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

const jpegSize = (bytes: Buffer): { width: number; height: number } | null => {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] ?? 0;
    if (SOF.has(marker)) return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  return null;
};

const inspect = (bytes: Buffer): ArtFacts | null => {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { contentType: "image/png", extension: "png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const size = jpegSize(bytes);
    return size ? { contentType: "image/jpeg", extension: "jpg", ...size } : null;
  }
  return null;
};

const plateKey = (plate: string): string => {
  const lower = plate.toLowerCase();
  return PLATES.some((name) => name.toLowerCase() === lower) ? lower : fail("not_found");
};

export const saveArt = async (plate: string, bytes: Buffer): Promise<Record<string, unknown>> => {
  const key = plateKey(plate);
  if (bytes.length > MAX_BYTES) return fail("art_too_large");
  const facts = inspect(bytes);
  if (!facts) return fail("art_wrong_type");
  if (facts.width > MAX_SIDE || facts.height > MAX_SIDE) return fail("art_too_many_pixels");
  const objectKey = `plates/${key}/${randomUUID()}.${facts.extension}`;
  try {
    await putObject(objectKey, bytes, facts.contentType);
  } catch (error) {
    if (error instanceof StorageUnreachable) return fail("storage_unreachable");
    throw error;
  }
  await pool.query(
    `INSERT INTO plate_art (plate, object_key, content_type) VALUES ($1, $2, $3)
     ON CONFLICT (plate) DO UPDATE SET object_key = excluded.object_key, content_type = excluded.content_type, updated_at = now()`,
    [key, objectKey, facts.contentType],
  );
  return { plate: key, artUrl: artUrl(key), bytes: bytes.length, width: facts.width, height: facts.height };
};

export const artUrl = (plate: string): string => `/api/plates/${plate.toLowerCase()}/art`;

export const hasArt = async (plate: string): Promise<boolean> =>
  (await pool.query("SELECT 1 FROM plate_art WHERE plate = $1", [plate.toLowerCase()])).rowCount === 1;

/** The latest uploaded art for a plate, or null before any upload. */
export const latestArt = async (plate: string): Promise<{ contentType: string; bytes: Buffer } | null> => {
  const row = (await pool.query("SELECT object_key, content_type FROM plate_art WHERE plate = $1", [plate.toLowerCase()])).rows[0] as
    { object_key: string; content_type: string } | undefined;
  const bytes = row ? await getObject(row.object_key) : null;
  return row && bytes ? { contentType: row.content_type, bytes } : null;
};

export const readArt = async (plate: string): Promise<{ contentType: string; bytes: Buffer }> => {
  try {
    return (await latestArt(plateKey(plate))) ?? fail("not_found");
  } catch (error) {
    if (error instanceof StorageUnreachable) return fail("storage_unreachable", { message: OUTAGE_COPY.download });
    throw error;
  }
};
