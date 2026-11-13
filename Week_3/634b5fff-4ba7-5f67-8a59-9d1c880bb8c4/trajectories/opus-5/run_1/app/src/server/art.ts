import { randomBytes } from 'node:crypto';
import { plates } from '../shared/copy.js';
import { query } from './db.js';
import { fail, failStorage } from './errors.js';
import { putObject } from './services/storage.js';

export const ART_MAX_BYTES = 5_000_000;
export const ART_MAX_PIXELS = 6000;
export const ART_MAX_BODY_BYTES = 5_100_000;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ArtShape {
  contentType: 'image/png' | 'image/jpeg';
  extension: 'png' | 'jpg';
  width: number;
  height: number;
}

/** The type and size are judged from the file's own leading bytes. */
export function readArtShape(file: Buffer): ArtShape | null {
  if (file.length > PNG_MAGIC.length && file.subarray(0, 8).equals(PNG_MAGIC)) {
    if (file.length < 24 || file.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
    return {
      contentType: 'image/png',
      extension: 'png',
      width: file.readUInt32BE(16),
      height: file.readUInt32BE(20),
    };
  }
  if (file.length > 3 && file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff) {
    const size = readJpegSize(file);
    if (size === null) return null;
    return { contentType: 'image/jpeg', extension: 'jpg', width: size.width, height: size.height };
  }
  return null;
}

function readJpegSize(file: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < file.length) {
    if (file[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = file[offset + 1] as number;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = file.readUInt16BE(offset + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      return { height: file.readUInt16BE(offset + 5), width: file.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

export function knownPlate(name: string): string | null {
  const found = plates.find((plate) => plate.toLowerCase() === name.toLowerCase());
  return found ?? null;
}

export interface SavedArt {
  plate: string;
  artUrl: string;
  bytes: number;
  width: number;
  height: number;
}

/** The latest upload for a plate is the one shown and printed. */
export async function savePlateArt(plate: string, file: Buffer): Promise<SavedArt> {
  if (file.length > ART_MAX_BYTES) throw fail(413, 'art_too_large');
  const shape = readArtShape(file);
  if (shape === null) throw fail(415, 'art_wrong_type');
  if (shape.width > ART_MAX_PIXELS || shape.height > ART_MAX_PIXELS) {
    throw fail(422, 'art_too_many_pixels');
  }
  const key = `plates/${plate.toLowerCase()}/${randomBytes(12).toString('hex')}.${shape.extension}`;
  try {
    await putObject(key, file, shape.contentType);
  } catch {
    throw failStorage('upload');
  }
  await query(
    `INSERT INTO plate_art (plate, object_key, content_type, bytes, width, height, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (plate) DO UPDATE SET object_key = $2, content_type = $3, bytes = $4,
         width = $5, height = $6, uploaded_at = now()`,
    [plate.toLowerCase(), key, shape.contentType, file.length, shape.width, shape.height],
  );
  return {
    plate,
    artUrl: `/api/plates/${plate.toLowerCase()}/art`,
    bytes: file.length,
    width: shape.width,
    height: shape.height,
  };
}

export async function plateArtRecord(
  plate: string,
): Promise<{ objectKey: string; contentType: string } | null> {
  const rows = await query<{ object_key: string; content_type: string }>(
    'SELECT object_key, content_type FROM plate_art WHERE plate = $1',
    [plate.toLowerCase()],
  );
  const row = rows[0];
  return row === undefined ? null : { objectKey: row.object_key, contentType: row.content_type };
}
