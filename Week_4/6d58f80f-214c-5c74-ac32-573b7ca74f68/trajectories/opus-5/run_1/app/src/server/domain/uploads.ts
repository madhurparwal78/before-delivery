import { db, newId, withTransaction, type Queryable } from '../db.js';
import { config } from '../config.js';
import { serverNow } from './clock.js';
import { writeLedger } from './ledger.js';
import {
  abortMultipart,
  completeMultipart,
  createMultipart,
  headObject,
  uploadPart,
} from '../services/storage.js';
import { PART_SIZE, type UploadState } from '../../shared/types.js';
import type { FileRow, UploadRow } from './rows.js';

export type UploadStep = 'part' | 'complete' | 'pause' | 'resume' | 'cancel';

const LIVE_STATES: UploadState[] = ['started', 'uploading', 'paused'];

/** The one place the upload state machine is decided. Null means the step may go ahead. */
export const stepRejection = (state: UploadState, step: UploadStep): string | null => {
  switch (step) {
    case 'part':
    case 'complete':
      return state === 'started' || state === 'uploading' ? null : `upload_${state}`;
    case 'pause':
      return LIVE_STATES.includes(state) ? null : `upload_${state}`;
    case 'resume':
      return LIVE_STATES.includes(state) ? null : `upload_${state}`;
    case 'cancel':
      return state === 'confirmed' ? 'upload_confirmed' : null;
  }
};

export const partCountFor = (size: number): number => Math.max(1, Math.ceil(size / PART_SIZE));

export const expectedPartSize = (size: number, partNumber: number): number => {
  const count = partCountFor(size);
  return partNumber === count ? size - (count - 1) * PART_SIZE : PART_SIZE;
};

export const uploadById = async (id: string, tx: Queryable = db): Promise<UploadRow | null> => {
  const { rows } = await tx.query<UploadRow>('SELECT * FROM uploads WHERE id = $1', [id]);
  return rows[0] ?? null;
};

export const uploadsOfPerson = async (
  personId: string,
  tx: Queryable = db,
): Promise<UploadRow[]> => {
  const { rows } = await tx.query<UploadRow>(
    `SELECT * FROM uploads WHERE person_id = $1
       AND state IN ('started','uploading','paused','abandoned') ORDER BY created_at ASC`,
    [personId],
  );
  return rows;
};

export const startUpload = async (input: {
  personId: string;
  folderId: string;
  name: string;
  size: number;
  contentType: string;
}): Promise<UploadRow> => {
  const id = newId();
  const storageUploadId = await createMultipart(id, input.contentType);
  const { rows } = await db.query<UploadRow>(
    `INSERT INTO uploads (id, person_id, folder_id, name, size, content_type, state,
                          storage_upload_id, parts, last_activity_at)
     VALUES ($1,$2,$3,$4,$5,$6,'started',$7,'[]'::jsonb,$8) RETURNING *`,
    [
      id,
      input.personId,
      input.folderId,
      input.name,
      input.size,
      input.contentType,
      storageUploadId,
      serverNow(),
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('upload insert returned nothing');
  return row;
};

export const acceptPart = async (
  upload: UploadRow,
  partNumber: number,
  body: Buffer,
): Promise<UploadRow> => {
  const etag = await uploadPart(upload.id, upload.storage_upload_id, partNumber, body);
  const parts = upload.parts.filter((part) => part.partNumber !== partNumber);
  parts.push({ partNumber, etag, size: body.length });
  parts.sort((a, b) => a.partNumber - b.partNumber);
  const { rows } = await db.query<UploadRow>(
    `UPDATE uploads SET parts = $2::jsonb, state = 'uploading', last_activity_at = $3
       WHERE id = $1 RETURNING *`,
    [upload.id, JSON.stringify(parts), serverNow()],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('upload part update returned nothing');
  return row;
};

export const setUploadState = async (
  upload: UploadRow,
  state: UploadState,
): Promise<UploadRow> => {
  const { rows } = await db.query<UploadRow>(
    'UPDATE uploads SET state = $2, last_activity_at = $3 WHERE id = $1 RETURNING *',
    [upload.id, state, serverNow()],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('upload state update returned nothing');
  return row;
};

export const missingParts = (upload: UploadRow): number[] => {
  const present = new Set(upload.parts.map((part) => part.partNumber));
  const missing: number[] = [];
  for (let part = 1; part <= partCountFor(upload.size); part += 1) {
    if (!present.has(part)) missing.push(part);
  }
  return missing;
};

/**
 * Finishes the object in storage, reads its stored size back, and only then creates the file
 * row, its ledger entry and the figures that follow from it, in one transaction.
 */
export const completeUpload = async (upload: UploadRow): Promise<FileRow> => {
  await completeMultipart(
    upload.id,
    upload.storage_upload_id,
    upload.parts.map((part) => ({ partNumber: part.partNumber, etag: part.etag })),
  );
  const stored = await headObject(upload.id);
  return withTransaction(async (tx) => {
    const { rows } = await tx.query<FileRow>(
      `INSERT INTO files (id, name, folder_id, size, content_type, modified_at, locked, state)
       VALUES ($1,$2,$3,$4,$5,$6,false,'live')
       RETURNING id, name, folder_id, size, content_type, modified_at, locked, state`,
      [
        upload.id,
        upload.name,
        upload.folder_id,
        stored.size,
        upload.content_type,
        serverNow(),
      ],
    );
    const file = rows[0];
    if (file === undefined) throw new Error('file insert returned nothing');
    await tx.query(`UPDATE uploads SET state = 'confirmed', last_activity_at = $2 WHERE id = $1`, [
      upload.id,
      serverNow(),
    ]);
    const folder = await tx.query<{ name: string }>('SELECT name FROM folders WHERE id = $1', [
      upload.folder_id,
    ]);
    await writeLedger(tx, {
      actorId: upload.person_id,
      action: 'uploaded',
      fileId: file.id,
      folderId: upload.folder_id,
      detail: { fileName: file.name, folderName: folder.rows[0]?.name ?? '' },
    });
    return file;
  });
};

export const cancelUpload = async (upload: UploadRow): Promise<void> => {
  await db.query(`UPDATE uploads SET state = 'cancelled' WHERE id = $1`, [upload.id]);
  await recordDebris(upload);
  await clearDebris();
};

export const abandonUpload = async (upload: UploadRow): Promise<void> => {
  await db.query(`UPDATE uploads SET state = 'abandoned' WHERE id = $1`, [upload.id]);
  await recordDebris(upload);
  await clearDebris();
};

export const dismissUpload = async (upload: UploadRow): Promise<void> => {
  await db.query('DELETE FROM uploads WHERE id = $1', [upload.id]);
};

/** Parts of cancelled and abandoned uploads are removed from storage, retried until they are. */
const recordDebris = async (upload: UploadRow): Promise<void> => {
  await db.query(
    `INSERT INTO storage_debris (id, storage_upload_id, purpose) VALUES ($1,$2,'multipart')
     ON CONFLICT (id) DO NOTHING`,
    [upload.id, upload.storage_upload_id],
  );
};

export const clearDebris = async (): Promise<void> => {
  const { rows } = await db.query<{ id: string; storage_upload_id: string | null }>(
    'SELECT id, storage_upload_id FROM storage_debris',
  );
  for (const row of rows) {
    if (row.storage_upload_id === null) continue;
    try {
      await abortMultipart(row.id, row.storage_upload_id);
      await db.query('DELETE FROM storage_debris WHERE id = $1', [row.id]);
    } catch {
      return;
    }
  }
};

export const uploadIdleEdge = (upload: UploadRow): Date =>
  new Date(upload.last_activity_at.getTime() + config.uploadPauseTtlSeconds * 1000);

export const liveUploads = async (tx: Queryable = db): Promise<UploadRow[]> => {
  const { rows } = await tx.query<UploadRow>(
    `SELECT * FROM uploads WHERE state IN ('started','uploading','paused')`,
  );
  return rows;
};
