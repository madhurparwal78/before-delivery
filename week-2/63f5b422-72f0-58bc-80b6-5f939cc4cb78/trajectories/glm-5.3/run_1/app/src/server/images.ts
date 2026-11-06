// Image uploads: type sniffing by signature bytes, size limits, confirm-by-read-back.
import { db } from './db.js';
import { makeS3Call, imageKey, isStorageUnavailable } from './s3.js';
import { HttpError } from './errors.js';
import { newId } from './ids.js';
import type { WorkspaceDocument } from '../shared/domain.js';

const MAX_BYTES = 5_000_000;

export interface ImageMeta { contentType: 'image/png' | 'image/jpeg' | 'image/webp'; width: number; height: number }

export function sniffImage(buf: Buffer): ImageMeta | null {
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    return { contentType: 'image/png', width: w, height: h };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const dim = jpegSize(buf);
    return { contentType: 'image/jpeg', width: dim.width, height: dim.height };
  }
  if (buf.length >= 16 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    const dim = webpSize(buf);
    return { contentType: 'image/webp', width: dim.width, height: dim.height };
  }
  return null;
}

function jpegSize(buf: Buffer): { width: number; height: number } {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return { width: 0, height: 0 };
    i += 2 + len;
  }
  return { width: 0, height: 0 };
}

function webpSize(buf: Buffer): { width: number; height: number } {
  const format = buf.subarray(12, 16).toString('ascii');
  if (format === 'VP8 ') {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (format === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  if (format === 'VP8X') {
    return { width: (buf.readUIntLE(24, 3)) + 1, height: (buf.readUIntLE(27, 3)) + 1 };
  }
  return { width: 0, height: 0 };
}

export interface UploadResult { id: string; status: 'confirmed'; fileName: string; width: number; height: number }

export async function uploadImage(workspaceId: string, fileName: string, buf: Buffer): Promise<UploadResult> {
  if (buf.length > MAX_BYTES) {
    throw new HttpError(413, { code: 'image_too_large' });
  }
  const meta = sniffImage(buf);
  if (!meta) throw new HttpError(415, { code: 'unsupported_image' });
  const id = newId('img');
  const call = makeS3Call(workspaceId);
  try {
    await call('PUT', `/${imageKey(workspaceId, id)}`, buf, { 'content-type': meta.contentType });
    const back = await call('GET', `/${imageKey(workspaceId, id)}`, null, {});
    if (back.body.length !== buf.length || !back.body.equals(buf)) {
      throw new Error('read-back mismatch');
    }
  } catch (err) {
    if (isStorageUnavailable(err)) throw new HttpError(503, { code: 'storage_unavailable' });
    throw err;
  }
  await db.query(
    'INSERT INTO images (id, workspace_id, file_name, content_type, width, height, size, status) VALUES ($1,$2,$3,$4,$5,$6,$7,\'confirmed\')',
    [id, workspaceId, fileName, meta.contentType, meta.width, meta.height, buf.length]);
  return { id, status: 'confirmed', fileName, width: meta.width, height: meta.height };
}

export interface ImageRecord { id: string; workspace_id: string; file_name: string; content_type: string; width: number; height: number; status: string }

export async function listImages(workspaceId: string): Promise<ImageRecord[]> {
  const res = await db.query<ImageRecord>(
    'SELECT id, workspace_id, file_name, content_type, width, height, status FROM images WHERE workspace_id = $1 AND status = \'confirmed\' ORDER BY created_at', [workspaceId]);
  return res.rows;
}

export async function getImage(imageId: string): Promise<ImageRecord | null> {
  const res = await db.query<ImageRecord>(
    'SELECT id, workspace_id, file_name, content_type, width, height, status FROM images WHERE id = $1', [imageId]);
  return res.rows[0] ?? null;
}

export async function getImageBytes(rec: ImageRecord): Promise<Buffer> {
  const call = makeS3Call(rec.workspace_id);
  const res = await call('GET', `/${imageKey(rec.workspace_id, rec.id)}`, null, {});
  if (res.status === 404 || res.body.length === 0) {
    throw new HttpError(503, { code: 'storage_unavailable' });
  }
  return res.body;
}

export async function storageStatus(workspaceId: string): Promise<'ok' | 'unavailable'> {
  try {
    const call = makeS3Call(workspaceId);
    await call('GET', `/${imageKey(workspaceId, 'probe')}`, null, {});
    return 'ok';
  } catch {
    return 'unavailable';
  }
}
