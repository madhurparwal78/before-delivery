import { query, queryOne } from '../db';
import { ApiError, FieldErrors, notFound } from '../errors';

import { isoOf, nowDate } from '../clock';
import { memberChannel } from '../domain/channels';
import { decodeCursor, encodeCursor } from '../domain/paging';
import { parsePageLimit } from '../domain/validate';
import { originalKey, thumbKey } from '../domain/photos';
import { getObject, StorageUnavailable } from '../services/storage';
import { noteStorage } from '../services/health';
import type { Route } from '../http/router';
import { queryParam, requireUser, type RequestContext, sendJson } from '../http/context';
import type { GalleryPhoto } from '../../shared/api';

interface AttachmentAccessRow {
  id: string;
  workspace_id: string;
  message_id: string;
  content_type: string;
}

async function reachableAttachment(ctx: RequestContext): Promise<AttachmentAccessRow> {
  const user = requireUser(ctx);
  const row = await queryOne<AttachmentAccessRow>(
    `SELECT a.id, a.workspace_id, a.message_id, a.content_type
     FROM attachments a
     JOIN messages m ON m.id = a.message_id AND m.deleted = false
     JOIN channel_members cm ON cm.channel_id = a.channel_id AND cm.user_id = $1
     WHERE a.id = $2 AND a.workspace_id = $3`,
    [user.id, ctx.params['id'], user.workspace_id],
  );
  if (row === null) throw notFound();
  return row;
}

function sendBinary(ctx: RequestContext, body: Buffer, contentType: string): void {
  ctx.res.writeHead(200, {
    'content-type': contentType,
    'content-length': body.length,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    date: nowDate().toUTCString(),
  });
  ctx.res.end(body);
}

async function fetchStored(key: string): Promise<{ body: Buffer; contentType: string }> {
  try {
    const stored = await getObject(key);
    noteStorage(true);
    if (stored === null) throw notFound();
    return stored;
  } catch (error) {
    if (error instanceof StorageUnavailable) {
      noteStorage(false);
      throw new ApiError('storage_unavailable');
    }
    throw error;
  }
}

async function getOriginal(ctx: RequestContext): Promise<void> {
  const row = await reachableAttachment(ctx);
  const stored = await fetchStored(originalKey(row.workspace_id, row.message_id, row.id));
  sendBinary(ctx, stored.body, row.content_type);
}

async function getThumb(ctx: RequestContext): Promise<void> {
  const row = await reachableAttachment(ctx);
  const stored = await fetchStored(thumbKey(row.workspace_id, row.message_id, row.id));
  sendBinary(ctx, stored.body, 'image/jpeg');
}

interface GalleryRow {
  attachment_id: string;
  message_id: string;
  filename: string;
  content_type: string;
  bytes: number;
  uploader_id: string;
  uploader_name: string;
  uploaded_at: Date;
}

async function getGallery(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const channelId = ctx.params['id'] as string;
  const channel = await memberChannel(user.id, user.workspace_id, channelId);
  if (channel === null) throw notFound();

  const errors = new FieldErrors();
  const limit = parsePageLimit(queryParam(ctx, 'limit'), errors);
  const cursor = decodeCursor(queryParam(ctx, 'before'), 2, errors);
  errors.throwIfAny();

  const params: unknown[] = [channelId];
  let clause = '';
  if (cursor !== null) {
    clause = ' AND (a.uploaded_at, a.id::text) < ($2::timestamptz, $3::text)';
    params.push(cursor[0], cursor[1]);
  }
  const rows = await query<GalleryRow>(
    `SELECT a.id AS attachment_id, a.message_id, a.filename, a.content_type, a.bytes,
            u.id AS uploader_id, u.name AS uploader_name, a.uploaded_at
     FROM attachments a
     JOIN users u ON u.id = a.uploaded_by
     JOIN messages m ON m.id = a.message_id AND m.deleted = false
     WHERE a.channel_id = $1 ${clause}
     ORDER BY a.uploaded_at DESC, a.id::text DESC
     LIMIT ${limit}`,
    params,
  );
  const photos: GalleryPhoto[] = rows.map((row) => ({
    attachment_id: row.attachment_id,
    message_id: row.message_id,
    filename: row.filename,
    content_type: row.content_type,
    bytes: row.bytes,
    uploaded_by: { id: row.uploader_id, name: row.uploader_name },
    uploaded_at: isoOf(row.uploaded_at),
    url: `/api/attachments/${row.attachment_id}`,
    thumb_url: `/api/attachments/${row.attachment_id}/thumb`,
  }));
  const last = rows[rows.length - 1];
  sendJson(ctx, 200, {
    photos,
    next_cursor: rows.length < limit || last === undefined ? null : encodeCursor([last.uploaded_at.toISOString(), last.attachment_id]),
  });
}

export const photoRoutes: Route[] = [
  { method: 'GET', pattern: '/api/attachments/:id', handler: getOriginal },
  { method: 'GET', pattern: '/api/attachments/:id/thumb', handler: getThumb },
  { method: 'GET', pattern: '/api/channels/:id/gallery', handler: getGallery },
];


