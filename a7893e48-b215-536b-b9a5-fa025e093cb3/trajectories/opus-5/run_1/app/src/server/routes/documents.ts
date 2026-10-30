import { randomUUID } from 'node:crypto';
import type { DocumentKind, RenterDocument } from '../../shared/types.js';
import { pool, query } from '../db/pool.js';
import { documentKey } from '../db/seed.js';
import { documentInScope, ownRenter, renterInScope } from '../domain/records.js';
import { isDateString } from '../domain/zone.js';
import { json, type Ctx, type Reply } from '../http/context.js';
import { ApiError, notFound, validation } from '../http/errors.js';
import { boundaryOf, fieldValue, filePart, parseMultipart } from '../http/multipart.js';
import type { Route } from '../http/router.js';
import { getObject, putObject } from '../services/storage.js';

export const MAX_DOCUMENT_BYTES = 5_000_000;

const KINDS: readonly DocumentKind[] = ['liability', 'food_handler'];

interface DetectedType {
  contentType: string;
  extension: string;
}

/** Judged by the file's leading bytes, never by its name or declared type. */
function detectType(bytes: Buffer): DetectedType | null {
  if (bytes.subarray(0, 4).toString('latin1') === '%PDF') {
    return { contentType: 'application/pdf', extension: 'pdf' };
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  return null;
}

function extensionFor(contentType: string): string {
  if (contentType === 'application/pdf') return 'pdf';
  return contentType === 'image/png' ? 'png' : 'jpg';
}

interface DocumentRecord {
  id: string;
  kind: DocumentKind;
  valid_from: string;
  expires_on: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: Date;
}

function present(row: DocumentRecord): RenterDocument {
  return {
    id: row.id,
    kind: row.kind,
    valid_from: row.valid_from,
    expires_on: row.expires_on,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    uploaded_at: row.uploaded_at.toISOString(),
  };
}

async function uploadDocument(ctx: Ctx): Promise<Reply> {
  const actor = ctx.requireRole('renter');
  const renter = await ownRenter(actor);
  const contentType = ctx.header('content-type') ?? '';
  const boundary = boundaryOf(contentType);
  if (boundary === null) throw validation({ file: 'Send the document as multipart/form-data.' });
  const parts = parseMultipart(ctx.rawBody, boundary);
  const kind = fieldValue(parts, 'kind');
  const validFrom = fieldValue(parts, 'valid_from');
  const expiresOn = fieldValue(parts, 'expires_on');
  const file = filePart(parts, 'file');

  if (file !== null && file.bytes.length > MAX_DOCUMENT_BYTES) {
    throw new ApiError(413, 'file_too_large', 'Files must be 5,000,000 bytes or smaller.', {
      limit_bytes: MAX_DOCUMENT_BYTES,
    });
  }
  if (file !== null && file.bytes.length > 0 && detectType(file.bytes) === null) {
    throw new ApiError(415, 'unsupported_file_type', 'Files must be PDF, PNG or JPEG.', {});
  }

  const fields: Record<string, string> = {};
  if (kind === null || !KINDS.includes(kind as DocumentKind)) {
    fields.kind = 'Choose a liability certificate or food handler card.';
  }
  if (!isDateString(validFrom)) fields.valid_from = 'Give a date as YYYY-MM-DD.';
  if (!isDateString(expiresOn)) fields.expires_on = 'Give a date as YYYY-MM-DD.';
  if (file === null || file.bytes.length === 0) fields.file = 'Choose a document file.';
  if (
    isDateString(validFrom) &&
    isDateString(expiresOn) &&
    (expiresOn as string) < (validFrom as string)
  ) {
    fields.expires_on = 'The expiry date cannot be before the valid-from date.';
  }
  if (Object.keys(fields).length > 0) throw validation(fields);

  const bytes = (file as { bytes: Buffer }).bytes;
  const detected = detectType(bytes) as DetectedType;
  const documentId = `doc-${randomUUID()}`;
  const key = documentKey(renter.id, documentId);
  await putObject(key, bytes, detected.contentType);
  const inserted = await pool.query<DocumentRecord>(
    `INSERT INTO documents (id, renter_id, kind, valid_from, expires_on, content_type, size_bytes, storage_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, kind, valid_from, expires_on, content_type, size_bytes, uploaded_at`,
    [
      documentId,
      renter.id,
      kind,
      validFrom,
      expiresOn,
      detected.contentType,
      bytes.length,
      key,
    ],
  );
  const row = inserted.rows[0];
  if (row === undefined) throw new Error('document insert returned nothing');
  return json(201, { document: present(row) });
}

export const documentRoutes: Route[] = [
  { method: 'POST', pattern: '/api/documents', multipart: true, handle: uploadDocument },
  {
    method: 'GET',
    pattern: '/api/documents',
    handle: async (ctx): Promise<Reply> => {
      const actor = ctx.requireActor();
      let renterId: string;
      if (actor.role === 'renter') {
        renterId = (await ownRenter(actor)).id;
      } else {
        const asked = ctx.queryValue('renter_id');
        if (asked === null) throw validation({ renter_id: 'Give a renter_id.' });
        renterId = (await renterInScope(actor, asked)).id;
      }
      const rows = await query<DocumentRecord>(
        pool,
        `SELECT id, kind, valid_from, expires_on, content_type, size_bytes, uploaded_at
           FROM documents WHERE renter_id = $1 ORDER BY uploaded_at DESC, id`,
        [renterId],
      );
      return json(200, { documents: rows.map(present) });
    },
  },
  {
    method: 'GET',
    pattern: '/api/documents/:id/file',
    handle: async (ctx): Promise<Reply> => {
      const actor = ctx.requireActor();
      const document = await documentInScope(actor, ctx.params.id as string);
      const stored = await getObject(document.storage_key);
      if (stored === null) throw notFound();
      return {
        status: 200,
        bytes: stored.body,
        contentType: document.content_type,
        headers: {
          'content-disposition': `inline; filename="${document.id}.${extensionFor(document.content_type)}"`,
        },
      };
    },
  },
];
