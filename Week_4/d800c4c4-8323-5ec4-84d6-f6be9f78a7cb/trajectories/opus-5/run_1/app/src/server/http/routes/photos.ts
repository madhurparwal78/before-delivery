import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { PhotoEvent } from '../../../shared/types';
import { parseTimestamp } from '../../../shared/time';
import { deletePhotoRecord, insertPhotoRecord, readPhotoRow } from '../../repo/loans';
import { storageProbe } from '../../services/status';
import { deletePhotoObject, photoKey, putPhotoObject } from '../../services/storage';
import { FieldProblems } from '../errors';
import type { UploadedFile } from '../multipart';

const CAPTURE_WINDOW_MS = 600_000;

const SIGNATURES: Record<string, (data: Buffer) => boolean> = {
  'image/jpeg': (data) =>
    data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
  'image/png': (data) =>
    data.length > 8 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  'image/webp': (data) =>
    data.length > 12 &&
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP',
};

export interface PhotoUpload {
  readonly file: UploadedFile;
  readonly capturedAt: Date;
}

/** The photo must be a JPEG, PNG or WebP whose first bytes carry that signature. */
export function validatePhotoUpload(
  problems: FieldProblems,
  file: UploadedFile | undefined,
  capturedAtText: string | undefined,
  now: Date,
): PhotoUpload | null {
  let valid: UploadedFile | null = null;
  if (!file || file.data.length === 0) {
    problems.add('photo', 'Take or choose a photo.');
  } else if (!SIGNATURES[file.contentType]?.(file.data)) {
    problems.add('photo', 'Send a JPEG, PNG or WebP photo.');
  } else {
    valid = file;
  }
  const parsed = capturedAtText === undefined ? null : parseTimestamp(capturedAtText);
  if (parsed === null) {
    problems.add('captured_at', 'Give an ISO 8601 capture time with an offset.');
  } else if (parsed.getTime() > now.getTime() + CAPTURE_WINDOW_MS) {
    problems.add('captured_at', 'That capture time is more than ten minutes ahead.');
  }
  if (!valid || parsed === null) return null;
  return { file: valid, capturedAt: parsed };
}

/**
 * Writes the photo object only after the loan's transition has been won, so a
 * losing or refused request leaves nothing in the bucket. A storage failure
 * takes the record back out before it is reported.
 */
export async function storePhoto(
  client: PoolClient,
  loanId: number,
  loanRef: string,
  event: PhotoEvent,
  upload: PhotoUpload,
): Promise<number> {
  const record = await insertPhotoRecord(client, loanId, event, {
    contentType: upload.file.contentType,
    byteSize: upload.file.data.length,
    sha256: createHash('sha256').update(upload.file.data).digest('hex'),
    capturedAt: upload.capturedAt,
    storageKeyFor: (photoId) => photoKey(loanRef, event, photoId),
  });
  try {
    await putPhotoObject(
      record.storage_key,
      upload.file.data,
      upload.file.contentType,
      upload.capturedAt.toISOString(),
    );
    storageProbe.markUp();
  } catch (error) {
    await deletePhotoRecord(client, record.id);
    throw error;
  }
  return record.id;
}

export async function removeStoredPhoto(client: PoolClient, photoId: number): Promise<void> {
  const record = await readPhotoRow(client, photoId);
  if (record) await deletePhotoObject(record.storage_key).catch(() => undefined);
}
