// Attachment uploads checked by content, downloads, and the storage status.
import { randomUUID } from 'node:crypto';
import { db, one, transaction } from '../db.ts';
import { apiError, notFound } from '../errors.ts';
import { emit } from '../events.ts';
import { header, ok, route, type Reply, type Request, type Route } from '../http.ts';
import { blockJson } from '../model.ts';
import { filePart } from '../multipart.ts';
import { deleteEventually, getObject, objectSize, orUnavailable, putObject, storageAvailable } from '../storage.ts';
import { blockOr404, touchObject } from './blocks.ts';
import { detectUploadType, isImageType, storedFilename } from '../../shared/upload.ts';

export const FILE_LIMIT = 10_000_000;

/** The download headers every attachment response sends, here and on the share surface. */
export function attachmentReply(bytes: Buffer, contentType: string): Reply {
  return {
    status: 200, bytes,
    headers: {
      'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': isImageType(contentType) ? 'inline' : 'attachment',
    },
  };
}

async function upload(req: Request) {
  const objectId = req.params.id;
  if (!(await db.query('SELECT 1 FROM objects WHERE id = $1', [objectId])).length) throw notFound();
  const part = filePart(req.rawBody, header(req, 'content-type') ?? '');
  if (!part) throw apiError(415, 'unsupported_media_type');
  if (part.bytes.length > FILE_LIMIT) throw apiError(413, 'too_large');
  const detected = detectUploadType(part.bytes);
  if (!detected || detected !== part.contentType) throw apiError(415, 'unsupported_media_type');
  const attachmentId = randomUUID();
  const key = `attachments/${objectId}/${attachmentId}`;
  const filename = storedFilename(part.filename);
  // The write counts only once a metadata read reports the uploaded size.
  await orUnavailable(async () => {
    await putObject(key, part.bytes, detected);
    if ((await objectSize(key)) !== part.bytes.length) {
      deleteEventually([key]);
      throw apiError(503, 'storage_unavailable');
    }
  }).catch((error: unknown) => {
    deleteEventually([key]);
    throw error;
  });
  let blockId: string;
  try {
    blockId = await transaction(async (tx) => {
      const exists = await one(tx, 'SELECT 1 AS ok FROM objects WHERE id = $1 FOR UPDATE', [objectId]);
      if (!exists) throw notFound();
      await tx.query('INSERT INTO attachments (id, object_id, filename, content_type, size_bytes, storage_key) VALUES ($1, $2, $3, $4, $5, $6)',
        [attachmentId, objectId, filename, detected, part.bytes.length, key]);
      const id = randomUUID();
      const [{ n }] = await tx.query<{ n: number }>('SELECT COALESCE(max(position), 0)::int AS n FROM blocks WHERE object_id = $1', [objectId]);
      await tx.query(`INSERT INTO blocks (id, object_id, kind, position, attachment_id, edited_at) VALUES ($1, $2, 'attachment', $3, $4, clock_timestamp())`,
        [id, objectId, n + 1, attachmentId]);
      await touchObject(tx, objectId);
      const row = await blockOr404(tx, id);
      await emit(tx, 'block.saved', { object_id: objectId, block: blockJson(row), ops: null, base_version: 0, label: req.session.label, edit_id: null });
      return id;
    });
  } catch (error) {
    deleteEventually([key]);
    throw error;
  }
  return ok(blockJson(await blockOr404(db, blockId)), 201);
}

async function download(req: Request) {
  const row = await one<{ storage_key: string; content_type: string }>(db, 'SELECT storage_key, content_type FROM attachments WHERE id = $1', [req.params.id]);
  if (!row) throw notFound();
  const bytes = await orUnavailable(() => getObject(row.storage_key));
  if (!bytes) throw apiError(503, 'storage_unavailable');
  return attachmentReply(bytes, row.content_type);
}

async function storage() {
  return ok({ storage: (await storageAvailable()) ? 'available' : 'unavailable' });
}

export const attachmentRoutes: Route[] = [
  route('POST', '/api/objects/:id/attachments', 'multipart', upload),
  route('GET', '/api/attachments/:id', 'none', download),
  route('GET', '/api/storage', 'none', storage),
];
