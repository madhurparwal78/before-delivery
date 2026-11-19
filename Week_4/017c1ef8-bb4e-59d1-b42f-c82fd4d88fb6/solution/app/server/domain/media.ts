import { now } from '../clock.js';
import { config } from '../config.js';
import { maybeRow, type Db } from '../db.js';
import { notFound, unprocessable, validation } from '../errors.js';
import { newId } from '../ids.js';
import { getObject, putConfirmed } from '../storage.js';
import { memberVisibleTo } from './visibility.js';

/** A private member's photo is shown on no card or list; only on their own profile and to its uploader. */
export const showsPhoto = (visibility: string): boolean => visibility !== 'private';
export const showsPhotoSql = (alias: string): string => `${alias}.visibility <> 'private'`;

export const photoUrl = (photoId: string | null): string | null => (photoId ? `/media/photos/${photoId}` : null);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_METADATA_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

/** JPEG without its APP1 to APP15 and comment segments; the image data is copied untouched. Null when malformed. */
function stripJpeg(jpeg: Buffer): Buffer | null {
  const kept: Buffer[] = [jpeg.subarray(0, 2)];
  let position = 2;
  while (position + 4 <= jpeg.length) {
    if (jpeg[position] !== 0xff) return null;
    const marker = jpeg[position + 1] as number;
    if (marker === 0xff) {
      position += 1;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) {
      kept.push(jpeg.subarray(position));
      return Buffer.concat(kept);
    }
    const end = position + 2 + jpeg.readUInt16BE(position + 2);
    if (end > jpeg.length) return null;
    const metadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!metadata) kept.push(jpeg.subarray(position, end));
    position = end;
  }
  return null;
}

/** PNG without its text, EXIF and time chunks; every other chunk is copied byte for byte. Null when malformed. */
function stripPng(png: Buffer): Buffer | null {
  const kept: Buffer[] = [PNG_SIGNATURE];
  let position = PNG_SIGNATURE.length;
  while (position + 12 <= png.length) {
    const length = png.readUInt32BE(position);
    const kind = png.toString('latin1', position + 4, position + 8);
    const end = position + 12 + length;
    if (end > png.length) return null;
    if (!PNG_METADATA_CHUNKS.has(kind)) kept.push(png.subarray(position, end));
    position = end;
    if (kind === 'IEND') return Buffer.concat(kept);
  }
  return null;
}

interface StoredPhoto {
  photo_id: string;
  url: string;
  bytes: number;
  content_type: 'image/jpeg' | 'image/png';
}

/** Validates, strips and stores an uploaded photo. It counts as stored only after storage confirms its size. */
export async function uploadPhoto(db: Db, memberId: string, file: Buffer): Promise<StoredPhoto> {
  if (file.length > config.photoMaxBytes) throw unprocessable('photo_too_large', { limit: config.photoMaxBytes });
  const isJpeg = file.length > 3 && file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff;
  const isPng = file.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
  const stripped = isJpeg ? stripJpeg(file) : isPng ? stripPng(file) : null;
  if (!stripped) throw unprocessable('photo_type');
  const contentType = isJpeg ? 'image/jpeg' : 'image/png';
  const id = newId();
  await putConfirmed(`photos/${id}.${isJpeg ? 'jpg' : 'png'}`, stripped, contentType);
  await db.query('INSERT INTO photos (id, member_id, object_key, content_type, bytes, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [id, memberId, `photos/${id}.${isJpeg ? 'jpg' : 'png'}`, contentType, stripped.length, now()]);
  return { photo_id: id, url: `/media/photos/${id}`, bytes: stripped.length, content_type: contentType };
}

/**
 * A photo's bytes for a viewer. An unattached photo is visible only to its uploader; an attached one follows
 * the visibility of whatever shows it (a profile that shows its photo, or a post the viewer may see).
 */
export async function readPhoto(db: Db, viewerId: string, photoId: string): Promise<{ bytes: Buffer; contentType: string }> {
  const photo = await maybeRow<{ object_key: string; content_type: string }>(
    db,
    `SELECT p.object_key, p.content_type FROM photos p
      WHERE p.id = $2 AND (
        p.member_id = $1
        OR EXISTS (SELECT 1 FROM members m WHERE m.photo_id = p.id AND m.confirmed AND ${memberVisibleTo('$1', 'm')}
                    AND (${showsPhotoSql('m')} OR m.id = $1))
        OR EXISTS (SELECT 1 FROM posts po JOIN members a ON a.id = po.author_id WHERE po.photo_id = p.id AND ${memberVisibleTo('$1', 'a')}))`,
    [viewerId, photoId],
  );
  if (!photo) throw notFound();
  return { bytes: await getObject(photo.object_key), contentType: photo.content_type };
}

/** Sets a photo the member uploaded as their profile photo (or clears it with null). */
export async function setProfilePhoto(db: Db, memberId: string, photoId: unknown): Promise<string | null> {
  if (photoId === null) {
    await db.query('UPDATE members SET photo_id = NULL WHERE id = $1', [memberId]);
    return null;
  }
  if (typeof photoId !== 'string') throw validation({ photo_id: 'Choose a photo.' });
  if (!(await maybeRow(db, 'SELECT 1 FROM photos WHERE id = $1 AND member_id = $2', [photoId, memberId]))) throw notFound();
  await db.query('UPDATE members SET photo_id = $2 WHERE id = $1', [memberId, photoId]);
  return photoUrl(photoId);
}
