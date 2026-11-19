import { randomUUID } from 'node:crypto';
import { ERRORS } from '../../shared/copy';
import { query, queryOne } from '../db';
import { refuse, validationFailure } from '../domain/errors';
import type { UploadDto } from '../../shared/types';
import {
  buildBuyerDerivative,
  fileNameIsRefused,
  judgeContent,
  originalHoldsLocation,
  type PlateMask,
} from './images';
import { objectKeys, putConfirmed, removeObject } from './storage';

const CONTENT_TYPES = { jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' } as const;

interface UploadRow {
  id: string;
  kind: 'photo' | 'invoice';
  file_name: string;
  sha256: string;
  bytes: number;
  content_type: string;
  derivative_sha256: string | null;
  location_removed: boolean;
  label: string | null;
}

export const uploadDto = (row: UploadRow): UploadDto => ({
  id: row.id,
  kind: row.kind,
  status: 'stored',
  fileName: row.file_name,
  sha256: row.sha256,
  bytes: row.bytes,
  contentType: row.content_type,
  derivativeSha256: row.derivative_sha256,
  locationRemoved: row.location_removed,
  label: row.label,
});

const UPLOAD_COLUMNS =
  'id, kind, file_name, sha256, bytes, content_type, derivative_sha256, location_removed, label';

export interface StoreUploadInput {
  carId: string;
  kind: 'photo' | 'invoice';
  fileName: string;
  bytes: Buffer;
  mask: PlateMask | null;
  label: string | null;
}

/**
 * Judges the content, builds the buyer copy, and reports the upload as stored only
 * once the object store has confirmed both objects and their hashes. If one write
 * fails after another succeeded, both objects are gone and no record remains.
 */
export const storeUpload = async (input: StoreUploadInput): Promise<UploadDto> => {
  const judged = await judgeContent(input.bytes);
  const allowed = input.kind === 'photo' ? ['jpeg', 'png'] : ['jpeg', 'png', 'pdf'];
  if (judged === 'rejected' || !allowed.includes(judged)) {
    throw refuse(415, 'unsupported_file', 'This file type is not accepted');
  }
  if (fileNameIsRefused(input.fileName)) throw validationFailure({ file: ERRORS.badFileName });

  const id = randomUUID();
  const originalKey = objectKeys.original(input.carId, id);
  const derivativeKey = objectKeys.derivative(input.carId, id);
  const locationRemoved = input.kind === 'photo' ? await originalHoldsLocation(input.bytes) : false;
  const derivative = input.kind === 'photo' ? await buildBuyerDerivative(input.bytes, input.mask) : null;

  let originalSha: string;
  let derivativeSha: string | null = null;
  try {
    originalSha = await putConfirmed(originalKey, input.bytes, CONTENT_TYPES[judged]);
    if (derivative !== null) derivativeSha = await putConfirmed(derivativeKey, derivative, 'image/jpeg');
  } catch {
    await removeObject(originalKey).catch(() => undefined);
    await removeObject(derivativeKey).catch(() => undefined);
    throw refuse(503, 'storage_unavailable', 'The file store is not answering');
  }

  await query(
    `INSERT INTO upload (id, car_id, kind, file_name, sha256, bytes, content_type, derivative_sha256, location_removed, label)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      input.carId,
      input.kind,
      input.fileName,
      originalSha,
      input.bytes.length,
      CONTENT_TYPES[judged],
      derivativeSha,
      locationRemoved,
      input.label,
    ],
  );

  const stored = await queryOne<UploadRow>(`SELECT ${UPLOAD_COLUMNS} FROM upload WHERE id = $1`, [id]);
  if (stored === null) throw new Error('The stored upload could not be read back');
  return uploadDto(stored);
};

export const listUploads = async (carId: string): Promise<UploadDto[]> => {
  const rows = await query<UploadRow>(
    `SELECT ${UPLOAD_COLUMNS} FROM upload WHERE car_id = $1 ORDER BY created_at ASC`,
    [carId],
  );
  return rows.map(uploadDto);
};
