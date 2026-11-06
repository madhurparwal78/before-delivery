import { randomUUID } from 'node:crypto';
import {
  Reply,
  RequestContext,
  Route,
  contentTypeOf,
  errorReply,
  isUuid,
  json,
  notFound,
  route,
  tooLarge,
  unsupportedMediaType,
} from '../http/core';
import { withTransaction } from '../db/pool';
import { commitWithEvents } from '../domain/commit';
import { LiveEvent } from '../events';
import { BLOCK_COLUMNS, BlockRow, blockJson, loadObject, touchObject } from '../domain/objects';
import {
  AttachmentType,
  UPLOAD_MAX_BYTES,
  detectUploadType,
  isImageType,
  safeFilename,
} from '../../shared/rules';
import {
  StorageUnavailable,
  attachmentKey,
  deleteObjectEventually,
  getObject,
  headObjectSize,
  probeStorage,
  putObject,
} from '../storage/s3';

export type MultipartPart = { name: string; filename: string; contentType: string; bytes: Buffer };

export function parseMultipart(body: Buffer, contentTypeHeader: string): MultipartPart[] {
  const match = /boundary="?([^";]+)"?/i.exec(contentTypeHeader);
  if (match === null) return [];
  const boundary = Buffer.from(`--${match[1]}`, 'utf8');
  const parts: MultipartPart[] = [];
  let index = body.indexOf(boundary);
  while (index !== -1) {
    const start = index + boundary.length;
    if (body.slice(start, start + 2).toString() === '--') break;
    const headerEnd = body.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headerText = body.slice(start, headerEnd).toString('utf8');
    const next = body.indexOf(boundary, headerEnd);
    const bodyEnd = next === -1 ? body.length : next - 2;
    const bytes = body.slice(headerEnd + 4, bodyEnd);
    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
    const typeMatch = /content-type:\s*([^\r\n;]+)/i.exec(headerText);
    parts.push({
      name: nameMatch === null ? '' : nameMatch[1],
      filename: filenameMatch === null ? '' : filenameMatch[1],
      contentType: typeMatch === null ? '' : typeMatch[1].trim().toLowerCase(),
      bytes,
    });
    if (next === -1) break;
    index = next;
  }
  return parts;
}

export const attachmentRoutes: Route[] = [
  route('POST', '/api/objects/:id/attachments', async (context: RequestContext): Promise<Reply> => {
    if (contentTypeOf(context.headers) !== 'multipart/form-data') throw unsupportedMediaType();
    const parts = parseMultipart(context.body, context.headers['content-type'] as string);
    const file = parts.find((part) => part.name === 'file');
    if (file === undefined) throw unsupportedMediaType();
    if (file.bytes.length > UPLOAD_MAX_BYTES) throw tooLarge();
    const detected = detectUploadType(file.bytes);
    if (detected === null || detected !== file.contentType) throw unsupportedMediaType();
    const objectId = context.params['id'];
    const object = await withTransaction(async (tx) => (isUuid(objectId) ? loadObject(tx, objectId) : null));
    if (object === null) throw notFound();

    const attachmentId = randomUUID();
    const key = attachmentKey(objectId, attachmentId);
    const filename = safeFilename(file.filename);
    try {
      await putObject(key, file.bytes, detected as AttachmentType);
      const size = await headObjectSize(key);
      if (size !== file.bytes.length) throw new StorageUnavailable('stored size differs');
    } catch {
      void deleteObjectEventually(key);
      throw errorReply(503, 'storage_unavailable');
    }
    try {
      const created = await commitWithEvents(async (tx) => {
        await tx.query(
          `insert into attachment (id, object_id, filename, content_type, size_bytes, storage_key)
           values ($1, $2, $3, $4, $5, $6)`,
          [attachmentId, objectId, filename, detected, file.bytes.length, key],
        );
        const position = await tx.one<{ next: number }>(
          'select coalesce(max(position), 0) + 1 as next from block where object_id = $1',
          [objectId],
        );
        const rows = await tx.query<BlockRow>(
          `insert into block (id, object_id, kind, position, attachment_id)
           values (gen_random_uuid(), $1, 'attachment', $2, $3) returning ${BLOCK_COLUMNS}`,
          [objectId, position === null ? 1 : position.next, attachmentId],
        );
        await touchObject(tx, objectId);
        const payload = await blockJson(tx, rows[0]);
        return {
          result: payload,
          events: [
            {
              type: 'block.saved',
              data: {
                object_id: objectId,
                block: payload,
                ops: null,
                base_version: 0,
                label: (context.session as { label: string }).label,
                edit_id: null,
              },
            },
          ] as LiveEvent[],
        };
      });
      return json(created, 201);
    } catch (error) {
      void deleteObjectEventually(key);
      throw error;
    }
  }),

  route('GET', '/api/attachments/:id', async (context: RequestContext): Promise<Reply> => {
    const id = context.params['id'];
    const attachment = await withTransaction(async (tx) => {
      if (!isUuid(id)) return null;
      return tx.one<{ filename: string; content_type: string; storage_key: string }>(
        'select filename, content_type, storage_key from attachment where id = $1',
        [id],
      );
    });
    if (attachment === null) throw notFound();
    let stored: { bytes: Buffer } | null;
    try {
      stored = await getObject(attachment.storage_key);
    } catch {
      throw errorReply(503, 'storage_unavailable');
    }
    if (stored === null) throw notFound();
    return {
      status: 200,
      raw: stored.bytes,
      contentType: attachment.content_type,
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': isImageType(attachment.content_type) ? 'inline' : 'attachment',
      },
    };
  }),

  route('GET', '/api/storage', async (): Promise<Reply> => {
    const available = await probeStorage();
    return json({ storage: available ? 'available' : 'unavailable' });
  }),
];
