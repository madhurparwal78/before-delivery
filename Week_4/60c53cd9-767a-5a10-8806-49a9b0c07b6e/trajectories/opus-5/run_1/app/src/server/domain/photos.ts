/**
 * View photographs: stored exactly as sent, and marked photographed only once
 * the stored object's size and checksum match the bytes received.
 */

import { pool, query, queryOne, withTransaction } from '../db';
import { ApiError } from '../errors';
import { FIELD_MESSAGES } from '../../shared/errors';
import { headObject, putIfAbsent, StorageUnavailable } from '../storage/s3';
import { md5Hex, readImageSize, type ImageKind } from '../assets/image';
import { queueIndexUpdate } from '../search/pending';
import { loadUnit } from './units';
import { applyLapseCheck } from './lapse';

const MIN_WIDTH = 1024;
const MIN_HEIGHT = 512;

export interface StoredPhoto {
  key: string;
  size: number;
  checksum: string;
}

export function viewPhotoKey(code: string, checksum: string, kind: ImageKind): string {
  return `views/units/${code}/${checksum}.${kind === 'png' ? 'png' : 'jpg'}`;
}

/** Confirms a stored object by its size and MD5 ETag. */
export async function confirmStoredObject(key: string, body: Buffer): Promise<StoredPhoto | null> {
  const checksum = md5Hex(body);
  const head = await headObject(key);
  if (!head || head.size !== body.length || head.etag !== checksum) return null;
  return { key, size: body.length, checksum };
}

export async function storeViewPhoto(code: string, body: Buffer, kind: ImageKind): Promise<StoredPhoto> {
  await applyLapseCheck(pool);
  const unit = await loadUnit(pool, code);
  if (!unit) throw new ApiError('not_found');

  const size = readImageSize(body, kind);
  if (!size) throw new ApiError('invalid', { fields: { photo: FIELD_MESSAGES.photoUnreadable } });
  if (size.width < MIN_WIDTH || size.height < MIN_HEIGHT) {
    throw new ApiError('invalid', { fields: { photo: FIELD_MESSAGES.photoTooSmall } });
  }

  const claimed = await withTransaction(async (client) => {
    const locked = await queryOne<{ status: string; upload_in_progress: boolean }>(
      client,
      'select status, upload_in_progress from units where code = $1 for update',
      [code],
    );
    if (!locked) throw new ApiError('not_found');
    if (locked.status === 'withdrawn') throw new ApiError('unit_withdrawn');
    if (locked.upload_in_progress) throw new ApiError('upload_in_progress');
    await query(client, 'update units set upload_in_progress = true where code = $1', [code]);
    return true;
  });
  if (!claimed) throw new ApiError('upload_in_progress');

  try {
    const checksum = md5Hex(body);
    const key = viewPhotoKey(code, checksum, kind);
    await putIfAbsent(key, body, kind === 'png' ? 'image/png' : 'image/jpeg');
    const confirmed = await confirmStoredObject(key, body);
    if (!confirmed) throw new ApiError('upload_unconfirmed');
    await withTransaction(async (client) => {
      await query(
        client,
        `update units set view_photographed = true, view_photo_key = $2, view_photo_size = $3,
             view_photo_checksum = $4 where code = $1`,
        [code, confirmed.key, confirmed.size, confirmed.checksum],
      );
      await queueIndexUpdate(client, code, 'upsert');
    });
    return confirmed;
  } catch (error) {
    if (error instanceof StorageUnavailable) throw new ApiError('storage_unavailable');
    throw error;
  } finally {
    await query(pool, 'update units set upload_in_progress = false where code = $1', [code]);
  }
}
