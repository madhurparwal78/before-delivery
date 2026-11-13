import { createHash, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { query } from '../db/pool.js';
import { ApiError, ValidationError } from '../http/errors.js';
import { pathParam, route } from '../http/handler.js';
import { parseMultipart } from '../http/multipart.js';
import { requireCaller } from '../http/session.js';
import { commissionFor, fileFor } from '../domain/access.js';
import { objectKeys, putObject } from '../services/s3.js';
import { FIELD_ERRORS, uploadTooLarge, uploadWrongType } from '../../shared/copy.js';
import {
  UPLOAD_KINDS,
  UPLOAD_KIND_LABELS,
  UPLOAD_LIMITS,
  type UploadKind,
} from '../../shared/seed.js';
import { isoUtc } from '../../shared/venue-time.js';

export const filesRouter = Router();

/** The whole multipart request may exceed the file limit by this much. */
const ENVELOPE_SLACK_BYTES = 65_536;

/**
 * The displayed name is the last path segment, free of control characters and
 * cut to 120 characters. It is never used in a storage key.
 */
export function cleanFileName(raw: string): string {
  const lastSegment = raw.split(/[/\\]/).pop() ?? raw;
  const printable = lastSegment.replace(/[\u0000-\u001f\u007f]/g, '');
  return printable.slice(0, 120);
}

/** Type is judged by the bytes, never by the name or the declared type. */
export function contentMatchesKind(kind: UploadKind, bytes: Buffer): boolean {
  if (bytes.length === 0) return false;
  switch (kind) {
    case 'brief_pdf':
      return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'venue_photo': {
      const isPng =
        bytes.length >= 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
      const isJpeg =
        bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      return isPng || isJpeg;
    }
    case 'installation_glb': {
      if (bytes.length < 12) return false;
      if (bytes.subarray(0, 4).toString('latin1') !== 'glTF') return false;
      if (bytes.readUInt32LE(4) !== 2) return false;
      return bytes.readUInt32LE(8) === bytes.length;
    }
  }
}

export function contentTypeFor(kind: UploadKind, bytes: Buffer): string {
  if (kind === 'brief_pdf') return 'application/pdf';
  if (kind === 'installation_glb') return 'model/gltf-binary';
  return bytes[0] === 0x89 ? 'image/png' : 'image/jpeg';
}

filesRouter.post(
  '/api/commissions/:commissionId/files',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const commission = await commissionFor(pathParam(req, 'commissionId'), caller);

    const largestLimit = Math.max(...Object.values(UPLOAD_LIMITS));
    const body = await parseMultipart(req, largestLimit + ENVELOPE_SLACK_BYTES);
    const kind = body.fields.get('kind') ?? '';
    if (!(UPLOAD_KINDS as readonly string[]).includes(kind)) {
      throw new ValidationError({ kind: FIELD_ERRORS.uploadKind });
    }
    const uploadKind = kind as UploadKind;
    const file = body.files.find((f) => f.name === 'file');
    const fileName = cleanFileName(file?.fileName ?? '');
    const bytes = file?.bytes ?? Buffer.alloc(0);
    const limit = UPLOAD_LIMITS[uploadKind];
    const kindLabel = UPLOAD_KIND_LABELS[uploadKind];

    // A file exactly at its limit is accepted.
    if (bytes.length > limit) {
      throw new ApiError(413, 'file_too_large', uploadTooLarge(fileName, limit, kindLabel), {
        limitBytes: limit,
      });
    }
    if (!contentMatchesKind(uploadKind, bytes)) {
      throw new ValidationError({ file: uploadWrongType(fileName, kindLabel) });
    }

    const id = randomUUID();
    const objectKey = objectKeys.file(commission.id, id);
    const contentType = contentTypeFor(uploadKind, bytes);
    // Stored only once the file store has confirmed the object's size.
    const stored = await putObject(objectKey, bytes, contentType);
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    await query(
      `INSERT INTO files
         (id, commission_id, kind, file_name, content_type, size_bytes, sha256, object_key, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'stored')`,
      [id, commission.id, uploadKind, fileName, contentType, stored.sizeBytes, sha256, objectKey],
    );

    res.status(201).json({
      id,
      kind: uploadKind,
      fileName,
      contentType,
      sizeBytes: stored.sizeBytes,
      sha256,
      status: 'stored',
      createdAt: isoUtc(new Date()),
    });
  }),
);

filesRouter.get(
  '/api/commissions/:commissionId/files',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const commission = await commissionFor(pathParam(req, 'commissionId'), caller);
    const result = await query<{
      id: string;
      kind: string;
      file_name: string;
      content_type: string;
      size_bytes: number;
      sha256: string;
      status: string;
      created_at: Date;
    }>('SELECT * FROM files WHERE commission_id = $1 ORDER BY created_at', [commission.id]);
    res.json({
      files: result.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        fileName: row.file_name,
        contentType: row.content_type,
        sizeBytes: row.size_bytes,
        sha256: row.sha256,
        status: row.status,
        createdAt: isoUtc(row.created_at),
      })),
    });
  }),
);

filesRouter.get(
  '/api/files/:fileId/content',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const file = await fileFor(pathParam(req, 'fileId'), caller);
    const { getObject } = await import('../services/s3.js');
    const object = await getObject(file.object_key);
    res.type(file.content_type).send(object.bytes);
  }),
);
