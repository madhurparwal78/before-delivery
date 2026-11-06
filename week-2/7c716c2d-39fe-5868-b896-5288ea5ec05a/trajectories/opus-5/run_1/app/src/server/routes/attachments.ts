import { randomUUID } from 'node:crypto';
import { nowDate } from '../clock.js';
import { db, type Queryable } from '../db.js';
import { ApiError } from '../errors.js';
import { canSeeChannel, requireWorkspace, visibleProjectIds, type Actor } from '../access.js';
import { contentDisposition, downloadContentType, objectKey } from '../domain/download.js';
import { codePointLength } from '../domain/text.js';
import { ATTACHMENT_LIMIT, HANDLED } from '../http.js';
import { parseFilePart } from '../multipart.js';
import { sessionRoute, type Route } from '../router.js';
import { deleteObject, getObject, putObject } from '../services/storage.js';
import { messageIdOrNotFound, uuidOrNotFound } from '../validate.js';
import { workspaceRow } from '../workspaces.js';
import type { Attachment, AttachmentParentType } from '../../shared/types.js';

type Parent = { type: AttachmentParentType; id: string; authorId: string | null };

async function issueParent(actor: Actor, key: string): Promise<Parent> {
  const projectIds = await visibleProjectIds(actor);
  const row = await db.one<{ key: string }>(
    `select key from issues where workspace_id = $1 and key = $2 and project_id = any($3::uuid[])`,
    [actor.workspaceId, key, projectIds],
  );
  if (row === undefined) throw new ApiError('not_found');
  return { type: 'issue', id: row.key, authorId: null };
}

async function messageParent(actor: Actor, messageId: number): Promise<Parent> {
  const row = await db.one<{ id: number; channel_id: string; author_id: string }>(
    'select id, channel_id, author_id from messages where id = $1 and workspace_id = $2 and deleted = false',
    [messageId, actor.workspaceId],
  );
  if (row === undefined) throw new ApiError('not_found');
  if (!(await canSeeChannel(actor, row.channel_id))) throw new ApiError('not_found');
  return { type: 'message', id: String(row.id), authorId: row.author_id };
}

async function docParent(actor: Actor, docId: string): Promise<Parent> {
  const projectIds = await visibleProjectIds(actor);
  const row = await db.one<{ id: string }>(
    'select id from docs where id = $1 and workspace_id = $2 and project_id = any($3::uuid[])',
    [docId, actor.workspaceId, projectIds],
  );
  if (row === undefined) throw new ApiError('not_found');
  return { type: 'doc', id: row.id, authorId: null };
}

/** Stores the file first, and leaves nothing behind when the row cannot be written. */
async function attach(
  actor: Actor,
  workspaceId: string,
  parent: Parent,
  rawBody: Buffer,
  contentType: string | undefined,
): Promise<Attachment> {
  const part = parseFilePart(rawBody, contentType, 'file');
  if (part.bytes.length > ATTACHMENT_LIMIT) throw new ApiError('too_large');
  if (part.bytes.length === 0) {
    throw new ApiError('validation', {
      fields: { file: 'That file is empty.' },
      message: 'That file is empty.',
    });
  }
  const nameLength = codePointLength(part.filename);
  if (nameLength < 1 || nameLength > 255) {
    throw new ApiError('validation', {
      fields: { file: 'That file name is too long. Use 255 characters or fewer.' },
      message: 'That file name is too long. Use 255 characters or fewer.',
    });
  }
  const workspace = await workspaceRow(workspaceId);
  const id = randomUUID();
  const key = objectKey(workspace.slug, id, part.filename);
  await putObject(key, part.bytes, part.contentType);
  try {
    await db.query(
      `insert into attachments (id, workspace_id, parent_type, parent_id, filename, size, content_type,
                                object_key, created_at, uploaded_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        workspaceId,
        parent.type,
        parent.id,
        part.filename,
        part.bytes.length,
        part.contentType,
        key,
        nowDate().toISOString(),
        actor.id,
      ],
    );
  } catch (error) {
    await deleteObject(key).catch(() => undefined);
    throw error;
  }
  return {
    id,
    filename: part.filename,
    size: part.bytes.length,
    content_type: part.contentType,
    parent: { type: parent.type, id: parent.id },
  };
}

async function visibleAttachment(
  actor: Actor,
  attachmentId: string,
  client: Queryable = db,
): Promise<{ filename: string; size: number; content_type: string; object_key: string }> {
  const row = await client.one<{
    filename: string;
    size: number;
    content_type: string;
    object_key: string;
    parent_type: AttachmentParentType;
    parent_id: string;
  }>(
    `select filename, size, content_type, object_key, parent_type, parent_id from attachments
      where id = $1 and workspace_id = $2`,
    [attachmentId, actor.workspaceId],
  );
  if (row === undefined) throw new ApiError('not_found');
  if (row.parent_type === 'issue') await issueParent(actor, row.parent_id);
  else if (row.parent_type === 'doc') await docParent(actor, row.parent_id);
  else await messageParent(actor, Number(row.parent_id));
  return { filename: row.filename, size: Number(row.size), content_type: row.content_type, object_key: row.object_key };
}

export const attachmentRoutes: Route[] = [
  sessionRoute('POST', '/api/issues/:key/attachments', 'multipart', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const parent = await issueParent(ctx.actor, ctx.params.key ?? '');
    const attachment = await attach(
      ctx.actor,
      workspaceId,
      parent,
      ctx.rawBody,
      ctx.request.headers['content-type'],
    );
    return { status: 201, body: attachment };
  }),

  sessionRoute('POST', '/api/messages/:id/attachments', 'multipart', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const parent = await messageParent(ctx.actor, messageIdOrNotFound(ctx.params.id));
    if (parent.authorId !== ctx.actor.id) throw new ApiError('not_author');
    const attachment = await attach(
      ctx.actor,
      workspaceId,
      parent,
      ctx.rawBody,
      ctx.request.headers['content-type'],
    );
    return { status: 201, body: attachment };
  }),

  sessionRoute('POST', '/api/docs/:id/attachments', 'multipart', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const parent = await docParent(ctx.actor, uuidOrNotFound(ctx.params.id));
    const attachment = await attach(
      ctx.actor,
      workspaceId,
      parent,
      ctx.rawBody,
      ctx.request.headers['content-type'],
    );
    return { status: 201, body: attachment };
  }),

  sessionRoute('GET', '/api/attachments/:id', 'none', async (ctx) => {
    requireWorkspace(ctx.actor);
    const attachment = await visibleAttachment(ctx.actor, uuidOrNotFound(ctx.params.id));
    const bytes = await getObject(attachment.object_key);
    ctx.response.writeHead(200, {
      'Content-Type': downloadContentType(attachment.content_type),
      'Content-Length': String(attachment.size),
      'Content-Disposition': contentDisposition(attachment.filename),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    ctx.response.end(bytes);
    return HANDLED;
  }),
];
