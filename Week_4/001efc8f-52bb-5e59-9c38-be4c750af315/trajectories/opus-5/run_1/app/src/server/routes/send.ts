import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { queryOne, withTransaction } from '../db';
import { LIMITS } from '../config';
import { nowDate } from '../clock';
import { ApiError, FieldErrors, notFound } from '../errors';
import { FIELD_COPY } from '../../shared/copy';
import { memberChannel } from '../domain/channels';
import { buildMessage, loadMessageRow, type MessageRow } from '../domain/messages';
import { mentionHandles } from '../domain/mentions';
import { assertSendRate } from '../domain/sendRate';
import { collectUnacceptedKeys, isUuid, SEND_FIELDS } from '../domain/validate';
import { originalKey, PhotoRejected, preparePhotos, thumbKey, type PreparedPhoto, type UploadedPart } from '../domain/photos';
import { putObject, StorageUnavailable } from '../services/storage';
import { noteStorage } from '../services/health';
import { removeObjects } from '../domain/removalQueue';
import { notifyMessageCreated, notifyMessageUpdated } from '../domain/notify';
import { readMultipartBody } from '../http/multipart';
import { readJsonBody, requireUser, sendJson, type RequestContext } from '../http/context';

export interface SendRequest {
  keys: string[];
  clientMessageId: unknown;
  text: unknown;
  threadRootId: unknown;
  quotedMessageId: unknown;
  files: UploadedPart[];
}

function textPart(value: string | undefined): unknown {
  if (value === undefined) return undefined;
  return value === '' ? null : value;
}

async function parseSend(ctx: RequestContext): Promise<SendRequest> {
  if (ctx.isMultipart) {
    const body = await readMultipartBody(ctx);
    const keys = body.order.filter((name) => name !== 'file');
    return {
      keys,
      clientMessageId: body.fields['client_message_id'],
      text: body.fields['text'],
      threadRootId: textPart(body.fields['thread_root_id']),
      quotedMessageId: textPart(body.fields['quoted_message_id']),
      files: body.files,
    };
  }
  const body = await readJsonBody(ctx);
  return {
    keys: Object.keys(body),
    clientMessageId: body['client_message_id'],
    text: body['text'],
    threadRootId: body['thread_root_id'],
    quotedMessageId: body['quoted_message_id'],
    files: [],
  };
}

interface StoredSend {
  id: string;
  deleted: boolean;
  text: string;
  thread_root_id: string | null;
  quoted_message_id: string | null;
  hashes: string[];
}

async function findStoredSend(
  authorId: string,
  clientMessageId: string,
  client?: Pick<PoolClient, 'query'>,
): Promise<StoredSend | null> {
  const sql = `SELECT m.id, m.deleted, m.text, m.thread_root_id, m.quoted_message_id,
      COALESCE((SELECT array_agg(a.source_hash ORDER BY a.source_hash) FROM attachments a WHERE a.message_id = m.id), '{}') AS hashes
    FROM messages m WHERE m.author_id = $1 AND m.client_message_id = $2`;
  if (client) {
    const result = await client.query<StoredSend>(sql, [authorId, clientMessageId]);
    return result.rows[0] ?? null;
  }
  return queryOne<StoredSend>(sql, [authorId, clientMessageId]);
}

function sameContent(stored: StoredSend, text: string, threadRootId: string | null, quotedMessageId: string | null, hashes: string[]): boolean {
  if (stored.text !== text) return false;
  if ((stored.thread_root_id ?? null) !== threadRootId) return false;
  if ((stored.quoted_message_id ?? null) !== quotedMessageId) return false;
  const left = [...stored.hashes].sort();
  const right = [...hashes].sort();
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

async function replayResponse(ctx: RequestContext, messageId: string): Promise<void> {
  const row = await loadMessageRow(messageId);
  if (row === null) throw notFound();
  const message = await buildMessage(row);
  sendJson(ctx, 201, { message }, { 'Rimewire-Replay': 'true' });
}

export async function handleSend(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const channelId = ctx.params['id'] as string;
  const channel = await memberChannel(user.id, user.workspace_id, channelId);
  if (channel === null) throw notFound();

  const request = await parseSend(ctx);

  const rawThreadRoot = request.threadRootId === undefined ? null : request.threadRootId;
  if (channel.kind === 'broadcast' && user.role === 'field_technician' && (rawThreadRoot === null || rawThreadRoot === '')) {
    throw new ApiError('broadcast_only');
  }

  const rawText = typeof request.text === 'string' ? request.text.trim() : '';
  const hashes = sourceHashes(request.files);

  if (isUuid(request.clientMessageId)) {
    const stored = await findStoredSend(user.id, request.clientMessageId);
    if (stored !== null) {
      if (stored.deleted) throw new ApiError('message_deleted');
      const threadRoot = isUuid(rawThreadRoot) ? rawThreadRoot : null;
      const quoted = isUuid(request.quotedMessageId) ? request.quotedMessageId : null;
      if (!sameContent(stored, rawText, threadRoot, quoted, hashes)) {
        throw new ApiError('client_message_id_conflict');
      }
      await replayResponse(ctx, stored.id);
      return;
    }
  }

  await assertSendRate(user.id);

  const errors = new FieldErrors();
  collectUnacceptedKeys(request.keys, SEND_FIELDS, errors);

  if (!isUuid(request.clientMessageId)) errors.add('client_message_id', FIELD_COPY.clientMessageId);

  if (typeof request.text === 'string' || request.text === undefined || request.text === null) {
    if (rawText.length === 0 && request.files.length === 0) errors.add('text', FIELD_COPY.textEmpty);
    if ([...rawText].length > LIMITS.textCharacters) errors.add('text', FIELD_COPY.textTooLong);
  } else {
    errors.add('text', FIELD_COPY.textEmpty);
  }

  let threadRootId: string | null = null;
  if (rawThreadRoot !== null) {
    if (!isUuid(rawThreadRoot)) {
      errors.add('thread_root_id', FIELD_COPY.threadRootId);
    } else {
      const root = await queryOne<{ id: string }>(
        'SELECT id FROM messages WHERE id = $1 AND channel_id = $2 AND thread_root_id IS NULL AND deleted = false',
        [rawThreadRoot, channelId],
      );
      if (root === null) errors.add('thread_root_id', FIELD_COPY.threadRootId);
      else threadRootId = root.id;
    }
  }

  let quotedMessageId: string | null = null;
  const rawQuote = request.quotedMessageId === undefined ? null : request.quotedMessageId;
  if (rawQuote !== null) {
    if (!isUuid(rawQuote)) {
      errors.add('quoted_message_id', FIELD_COPY.quotedMessageId);
    } else {
      const quoted = await queryOne<{ id: string }>(
        'SELECT id FROM messages WHERE id = $1 AND channel_id = $2 AND deleted = false',
        [rawQuote, channelId],
      );
      if (quoted === null) errors.add('quoted_message_id', FIELD_COPY.quotedMessageId);
      else quotedMessageId = quoted.id;
    }
  }

  let photos: PreparedPhoto[] = [];
  if (request.files.length > 0) {
    try {
      photos = await preparePhotos(request.files);
    } catch (error) {
      if (error instanceof PhotoRejected) errors.add('files', error.copy);
      else throw error;
    }
  }

  errors.throwIfAny();

  const messageId = randomUUID();
  const writtenKeys: string[] = [];
  if (photos.length > 0) {
    try {
      for (const photo of photos) {
        const original = originalKey(user.workspace_id, messageId, photo.attachmentId);
        const thumb = thumbKey(user.workspace_id, messageId, photo.attachmentId);
        await putObject(original, photo.original, photo.contentType);
        writtenKeys.push(original);
        await putObject(thumb, photo.thumbnail, 'image/jpeg');
        writtenKeys.push(thumb);
      }
      noteStorage(true);
    } catch (error) {
      noteStorage(false);
      await removeObjects(writtenKeys);
      if (error instanceof StorageUnavailable) throw new ApiError('storage_unavailable');
      throw error;
    }
  }

  const clientMessageId = request.clientMessageId as string;
  const outcome = await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`send:${user.id}`]);
    const stored = await findStoredSend(user.id, clientMessageId, client);
    if (stored !== null) {
      if (stored.deleted) return { kind: 'deleted' as const };
      if (!sameContent(stored, rawText, threadRootId, quotedMessageId, hashes)) return { kind: 'conflict' as const };
      return { kind: 'replay' as const, messageId: stored.id };
    }
    await assertSendRate(user.id, client);
    const sentAt = nowDate();
    await client.query(
      `INSERT INTO messages (id, workspace_id, channel_id, author_id, client_message_id, text, version, sent_at, thread_root_id, quoted_message_id, counted)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9, true)`,
      [messageId, user.workspace_id, channelId, user.id, clientMessageId, rawText, sentAt, threadRootId, quotedMessageId],
    );
    await client.query(
      'INSERT INTO message_versions (message_id, version, text, edited_by, created_at) VALUES ($1, 1, $2, $3, $4)',
      [messageId, rawText, user.id, sentAt],
    );
    await client.query(
      `INSERT INTO receipts (message_id, user_id, delivered_at)
       SELECT $1, cm.user_id, NULL FROM channel_members cm WHERE cm.channel_id = $2 AND cm.user_id <> $3`,
      [messageId, channelId, user.id],
    );
    for (const [index, photo] of photos.entries()) {
      await client.query(
        `INSERT INTO attachments (id, workspace_id, channel_id, message_id, uploaded_by, filename, content_type, bytes, width, height, source_hash, position, uploaded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          photo.attachmentId,
          user.workspace_id,
          channelId,
          messageId,
          user.id,
          photo.filename,
          photo.contentType,
          photo.bytes,
          photo.width,
          photo.height,
          photo.sourceHash,
          index,
          sentAt,
        ],
      );
    }
    const handles = mentionHandles(rawText);
    if (handles.length > 0) {
      await client.query(
        `INSERT INTO mentions (workspace_id, channel_id, message_id, user_id, thread_root_id, created_at)
         SELECT $1, $2, $3, u.id, $4, $5
         FROM users u
         JOIN channel_members cm ON cm.channel_id = $2 AND cm.user_id = u.id
         WHERE u.workspace_id = $1 AND lower(u.handle) = ANY($6::text[]) AND u.id <> $7
         ON CONFLICT (message_id, user_id) DO NOTHING`,
        [user.workspace_id, channelId, messageId, threadRootId, sentAt, handles, user.id],
      );
    }
    return { kind: 'created' as const };
  }).catch(async (error: unknown) => {
    await removeObjects(writtenKeys);
    throw error;
  });

  if (outcome.kind !== 'created') {
    await removeObjects(writtenKeys);
    if (outcome.kind === 'deleted') throw new ApiError('message_deleted');
    if (outcome.kind === 'conflict') throw new ApiError('client_message_id_conflict');
    await replayResponse(ctx, outcome.messageId);
    return;
  }

  const row = await loadMessageRow(messageId);
  const message = await buildMessage(row as MessageRow);
  sendJson(ctx, 201, { message });
  await notifyMessageCreated(user.workspace_id, channelId, user.id, message);
  if (threadRootId !== null) await notifyMessageUpdated(user.workspace_id, channelId, threadRootId);
}

function sourceHashes(files: UploadedPart[]): string[] {
  return files.map((file) => createHash('sha256').update(file.buffer).digest('hex'));
}

export async function postScheduledMessage(
  workspaceId: string,
  channelId: string,
  authorId: string,
  text: string,
): Promise<string> {
  const messageId = randomUUID();
  const sentAt = nowDate();
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO messages (id, workspace_id, channel_id, author_id, client_message_id, text, version, sent_at, counted)
       VALUES ($1, $2, $3, $4, NULL, $5, 1, $6, false)`,
      [messageId, workspaceId, channelId, authorId, text, sentAt],
    );
    await client.query(
      'INSERT INTO message_versions (message_id, version, text, edited_by, created_at) VALUES ($1, 1, $2, $3, $4)',
      [messageId, text, authorId, sentAt],
    );
    await client.query(
      `INSERT INTO receipts (message_id, user_id, delivered_at)
       SELECT $1, cm.user_id, NULL FROM channel_members cm WHERE cm.channel_id = $2 AND cm.user_id <> $3`,
      [messageId, channelId, authorId],
    );
    const handles = mentionHandles(text);
    if (handles.length > 0) {
      await client.query(
        `INSERT INTO mentions (workspace_id, channel_id, message_id, user_id, thread_root_id, created_at)
         SELECT $1, $2, $3, u.id, NULL, $4
         FROM users u
         JOIN channel_members cm ON cm.channel_id = $2 AND cm.user_id = u.id
         WHERE u.workspace_id = $1 AND lower(u.handle) = ANY($5::text[]) AND u.id <> $6
         ON CONFLICT (message_id, user_id) DO NOTHING`,
        [workspaceId, channelId, messageId, sentAt, handles, authorId],
      );
    }
  });
  const row = await loadMessageRow(messageId);
  if (row !== null) {
    const message = await buildMessage(row);
    await notifyMessageCreated(workspaceId, channelId, authorId, message);
  }
  return messageId;
}
