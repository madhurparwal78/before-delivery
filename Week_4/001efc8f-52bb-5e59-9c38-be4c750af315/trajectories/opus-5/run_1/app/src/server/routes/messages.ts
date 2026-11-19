import { query, queryOne, withTransaction } from '../db';
import { LIMITS } from '../config';
import { isoOf, nowDate, nowMs } from '../clock';
import { ApiError, FieldErrors, forbidden, notFound } from '../errors';
import { FIELD_COPY } from '../../shared/copy';
import { memberChannel } from '../domain/channels';
import { buildMessage, buildMessages, editableUntil, MESSAGE_COLUMNS, MESSAGE_FROM, type MessageRow } from '../domain/messages';
import { readableMessageRow } from '../domain/messageAccess';
import { decodeCursor, encodeCursor } from '../domain/paging';
import { collectUnacceptedKeys, EDIT_FIELDS, isUuid, parsePageLimit } from '../domain/validate';
import { canModerate } from '../domain/users';
import { originalKey, thumbKey } from '../domain/photos';
import { queueRemovals, removeObjects } from '../domain/removalQueue';
import { notifyMessageDeleted, notifyMessageUpdated, notifyReceipts } from '../domain/notify';
import { handleSend } from './send';
import type { Route } from '../http/router';
import {
  queryParam,
  readJsonBody,
  requireUser,
  sendJson,
  sendNoContent,
  type RequestContext,
  type SessionUser,
} from '../http/context';
import type { MessageVersion, Recipient } from '../../shared/api';

function cursorClause(parts: string[] | null, start: number): { sql: string; params: unknown[] } {
  if (parts === null) return { sql: '', params: [] };
  return {
    sql: ` AND (m.sent_at, m.id::text) < ($${start}::timestamptz, $${start + 1}::text)`,
    params: [parts[0], parts[1]],
  };
}

function nextCursor(rows: MessageRow[], limit: number): string | null {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1]!;
  return encodeCursor([last.sent_at.toISOString(), last.id]);
}

async function listChannelMessages(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const channelId = ctx.params['id'] as string;
  const channel = await memberChannel(user.id, user.workspace_id, channelId);
  if (channel === null) throw notFound();

  const errors = new FieldErrors();
  const limit = parsePageLimit(queryParam(ctx, 'limit'), errors);
  const cursor = decodeCursor(queryParam(ctx, 'before'), 2, errors);
  errors.throwIfAny();

  const clause = cursorClause(cursor, 2);
  const rows = await query<MessageRow>(
    `SELECT ${MESSAGE_COLUMNS} ${MESSAGE_FROM}
     WHERE m.channel_id = $1 AND m.thread_root_id IS NULL
       AND (m.deleted = false OR ${'(SELECT count(*) FROM messages reply WHERE reply.thread_root_id = m.id AND reply.deleted = false) > 0'})
       ${clause.sql}
     ORDER BY m.sent_at DESC, m.id::text DESC
     LIMIT ${limit}`,
    [channelId, ...clause.params],
  );
  const messages = await buildMessages(rows);
  sendJson(ctx, 200, { messages, next_cursor: nextCursor(rows, limit) });
}

async function getMessage(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const row = await readableMessageRow(user, ctx.params['id'] as string);
  sendJson(ctx, 200, { message: await buildMessage(row) });
}

async function getThread(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const rootRow = await readableMessageRow(user, ctx.params['id'] as string, true);
  if (rootRow.thread_root_id !== null) throw notFound();
  if (rootRow.deleted && rootRow.reply_count === 0) throw notFound();

  const errors = new FieldErrors();
  const limit = parsePageLimit(queryParam(ctx, 'limit'), errors);
  const cursor = decodeCursor(queryParam(ctx, 'before'), 2, errors);
  errors.throwIfAny();

  const clause = cursorClause(cursor, 2);
  const rows = await query<MessageRow>(
    `SELECT ${MESSAGE_COLUMNS} ${MESSAGE_FROM}
     WHERE m.thread_root_id = $1 AND m.deleted = false ${clause.sql}
     ORDER BY m.sent_at DESC, m.id::text DESC
     LIMIT ${limit}`,
    [rootRow.id, ...clause.params],
  );
  const [root] = await buildMessages([rootRow]);
  const replies = await buildMessages(rows);
  sendJson(ctx, 200, { root, replies, next_cursor: nextCursor(rows, limit) });
}

async function getVersions(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const row = await readableMessageRow(user, ctx.params['id'] as string);
  sendJson(ctx, 200, { versions: await loadVersions(row.id) });
}

async function loadVersions(messageId: string): Promise<MessageVersion[]> {
  const rows = await query<{ version: number; text: string; editor_id: string; editor_name: string; created_at: Date }>(
    `SELECT v.version, v.text, v.edited_by AS editor_id, u.name AS editor_name, v.created_at
     FROM message_versions v JOIN users u ON u.id = v.edited_by
     WHERE v.message_id = $1 ORDER BY v.version ASC`,
    [messageId],
  );
  return rows.map((row) => ({
    version: row.version,
    text: row.text,
    edited_by: { id: row.editor_id, name: row.editor_name },
    created_at: isoOf(row.created_at),
  }));
}

async function patchMessage(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const row = await readableMessageRow(user, ctx.params['id'] as string);
  if (row.author_id !== user.id && !canModerate(user.role)) throw forbidden();

  const body = await readJsonBody(ctx);
  const expected = body['expected_version'];

  if (Number.isInteger(expected) && expected !== row.version) {
    throw new ApiError('stale_version', { current: await currentVersionShape(row) });
  }
  if (nowMs() >= new Date(editableUntil(row.sent_at)).getTime()) throw new ApiError('edit_window_closed');

  const errors = new FieldErrors();
  collectUnacceptedKeys(Object.keys(body), EDIT_FIELDS, errors);
  if (!Number.isInteger(expected)) errors.add('expected_version', FIELD_COPY.expectedVersion);
  const rawText = typeof body['text'] === 'string' ? (body['text'] as string).trim() : null;
  if (rawText === null) {
    errors.add('text', FIELD_COPY.textEmpty);
  } else if ([...rawText].length > LIMITS.textCharacters) {
    errors.add('text', FIELD_COPY.textTooLong);
  } else if (rawText.length === 0) {
    const attachments = await queryOne<{ count: number }>(
      'SELECT count(*)::int AS count FROM attachments WHERE message_id = $1',
      [row.id],
    );
    if ((attachments?.count ?? 0) === 0) errors.add('text', FIELD_COPY.textEmpty);
  }
  errors.throwIfAny();

  const text = rawText as string;
  const outcome = await withTransaction(async (client) => {
    const locked = await client.query<{ version: number; deleted: boolean }>(
      'SELECT version, deleted FROM messages WHERE id = $1 FOR UPDATE',
      [row.id],
    );
    const current = locked.rows[0];
    if (current === undefined || current.deleted) return { kind: 'gone' as const };
    if (current.version !== expected) return { kind: 'stale' as const };
    const version = current.version + 1;
    const editedAt = nowDate();
    await client.query('UPDATE messages SET text = $2, version = $3, edited_at = $4 WHERE id = $1', [
      row.id,
      text,
      version,
      editedAt,
    ]);
    await client.query(
      'INSERT INTO message_versions (message_id, version, text, edited_by, created_at) VALUES ($1, $2, $3, $4, $5)',
      [row.id, version, text, user.id, editedAt],
    );
    return { kind: 'saved' as const };
  });

  if (outcome.kind === 'gone') throw notFound();
  if (outcome.kind === 'stale') {
    const fresh = await readableMessageRow(user, row.id);
    throw new ApiError('stale_version', { current: await currentVersionShape(fresh) });
  }

  const updated = await readableMessageRow(user, row.id);
  sendJson(ctx, 200, { message: await buildMessage(updated) });
  await notifyMessageUpdated(user.workspace_id, row.channel_id, row.id);
}

async function currentVersionShape(row: MessageRow): Promise<{
  version: number;
  text: string;
  edited_by: { id: string; name: string };
  edited_at: string;
}> {
  const versions = await loadVersions(row.id);
  const latest = versions[versions.length - 1];
  return {
    version: row.version,
    text: row.text,
    edited_by: latest ? latest.edited_by : { id: row.author_id, name: row.author_name },
    edited_at: isoOf(row.edited_at ?? row.sent_at),
  };
}

async function deleteMessage(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const row = await readableMessageRow(user, ctx.params['id'] as string);
  if (row.author_id !== user.id && !canModerate(user.role)) throw forbidden();

  const outcome = await withTransaction(async (client) => {
    const locked = await client.query<{ deleted: boolean }>('SELECT deleted FROM messages WHERE id = $1 FOR UPDATE', [
      row.id,
    ]);
    if (locked.rows[0] === undefined || locked.rows[0].deleted) return null;
    const attachments = await client.query<{ id: string }>('SELECT id FROM attachments WHERE message_id = $1', [row.id]);
    const keys = attachments.rows.flatMap((attachment) => [
      originalKey(row.workspace_id, row.id, attachment.id),
      thumbKey(row.workspace_id, row.id, attachment.id),
    ]);
    await queueRemovals(keys, client);
    await client.query('DELETE FROM attachments WHERE message_id = $1', [row.id]);
    await client.query('DELETE FROM message_versions WHERE message_id = $1', [row.id]);
    await client.query('DELETE FROM receipts WHERE message_id = $1', [row.id]);
    await client.query('DELETE FROM message_reads WHERE message_id = $1', [row.id]);
    await client.query('DELETE FROM mentions WHERE message_id = $1', [row.id]);
    await client.query('DELETE FROM pins WHERE message_id = $1', [row.id]);
    await client.query("UPDATE messages SET deleted = true, text = '' WHERE id = $1", [row.id]);
    if (row.thread_root_id !== null) {
      await client.query(
        `DELETE FROM messages root WHERE root.id = $1 AND root.deleted = true
         AND NOT EXISTS (SELECT 1 FROM messages reply WHERE reply.thread_root_id = root.id AND reply.deleted = false)`,
        [row.thread_root_id],
      );
    }
    return keys;
  });

  if (outcome === null) throw notFound();
  sendNoContent(ctx);
  await notifyMessageDeleted(row.workspace_id, row.channel_id, row.id, row.thread_root_id);
  await removeObjects(outcome);
}

async function getReceipts(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const row = await readableMessageRow(user, ctx.params['id'] as string);
  if (row.author_id !== user.id && !canModerate(user.role)) throw forbidden();

  const recipientRows = await query<{
    user_id: string;
    name: string;
    delivered_at: Date | null;
  }>(
    `SELECT cm.user_id, u.name, r.delivered_at
     FROM channel_members cm
     JOIN users u ON u.id = cm.user_id
     LEFT JOIN receipts r ON r.message_id = $1 AND r.user_id = cm.user_id
     JOIN messages m ON m.id = $1
     WHERE cm.channel_id = m.channel_id AND cm.user_id <> m.author_id AND cm.joined_at <= m.sent_at
     ORDER BY u.name ASC`,
    [row.id],
  );
  const readRows = await query<{ user_id: string; version: number; read_at: Date }>(
    'SELECT user_id, version, read_at FROM message_reads WHERE message_id = $1 ORDER BY read_at ASC',
    [row.id],
  );
  const recipients: Recipient[] = recipientRows.map((recipient) => ({
    user: { id: recipient.user_id, name: recipient.name },
    delivered_at: recipient.delivered_at === null ? null : isoOf(recipient.delivered_at),
    reads: readRows
      .filter((read) => read.user_id === recipient.user_id)
      .map((read) => ({ version: read.version, read_at: isoOf(read.read_at) })),
  }));

  sendJson(ctx, 200, {
    message_id: row.id,
    sent_at: isoOf(row.sent_at),
    as_of: isoOf(nowDate()),
    versions: await loadVersions(row.id),
    recipients,
    recipient_count: row.recipient_count,
    delivered_count: row.delivered_count,
    read_count: row.read_count,
  });
}

async function postReceipts(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const body = await readJsonBody(ctx);
  const rawIds = body['message_ids'];
  const rawState = body['state'];

  const ids = Array.isArray(rawIds) ? rawIds : [];
  const wellFormed = ids.filter((value): value is string => isUuid(value));
  if (wellFormed.length > 0) {
    const readable = await query<{ id: string; channel_id: string; author_id: string }>(
      `SELECT m.id, m.channel_id, m.author_id FROM messages m
       JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = $1
       WHERE m.id = ANY($2::uuid[]) AND m.workspace_id = $3 AND m.deleted = false`,
      [user.id, wellFormed, user.workspace_id],
    );
    if (readable.length !== new Set(wellFormed).size) throw notFound();

    const errors = new FieldErrors();
    validateReceiptBody(ids, rawState, errors);
    errors.throwIfAny();

    const updated = await recordReceipts(user, readable, rawState as 'delivered' | 'read');
    sendJson(ctx, 200, { updated });
    return;
  }

  const errors = new FieldErrors();
  validateReceiptBody(ids, rawState, errors);
  errors.throwIfAny();
  sendJson(ctx, 200, { updated: 0 });
}

function validateReceiptBody(ids: unknown[], state: unknown, errors: FieldErrors): void {
  if (ids.length < 1 || ids.length > LIMITS.receiptIdsMax || !ids.every((value) => isUuid(value))) {
    errors.add('message_ids', FIELD_COPY.messageIds);
  }
  if (state !== 'delivered' && state !== 'read') errors.add('state', FIELD_COPY.state);
}

async function recordReceipts(
  user: SessionUser,
  messages: { id: string; channel_id: string; author_id: string }[],
  state: 'delivered' | 'read',
): Promise<number> {
  let updated = 0;
  const touched: { messageId: string; channelId: string }[] = [];
  for (const message of messages) {
    if (message.author_id === user.id) continue;
    const at = nowDate();
    if (state === 'delivered') {
      const result = await query<{ message_id: string }>(
        `UPDATE receipts SET delivered_at = $3
         WHERE message_id = $1 AND user_id = $2 AND delivered_at IS NULL RETURNING message_id`,
        [message.id, user.id, at],
      );
      if (result.length > 0) {
        updated += 1;
        touched.push({ messageId: message.id, channelId: message.channel_id });
      }
      continue;
    }
    const inserted = await withTransaction(async (client) => {
      const version = await client.query<{ version: number }>('SELECT version FROM messages WHERE id = $1', [message.id]);
      const current = version.rows[0];
      if (current === undefined) return false;
      const read = await client.query(
        `INSERT INTO message_reads (message_id, user_id, version, read_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING RETURNING version`,
        [message.id, user.id, current.version, at],
      );
      await client.query(
        'UPDATE receipts SET delivered_at = COALESCE(delivered_at, $3) WHERE message_id = $1 AND user_id = $2',
        [message.id, user.id, at],
      );
      return read.rowCount !== null && read.rowCount > 0;
    });
    if (inserted) {
      updated += 1;
      touched.push({ messageId: message.id, channelId: message.channel_id });
    }
  }
  for (const entry of touched) {
    await notifyReceipts(user.workspace_id, entry.channelId, entry.messageId, state === 'read' ? user.id : null);
  }
  return updated;
}

async function pinMessage(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const channelId = ctx.params['id'] as string;
  const channel = await memberChannel(user.id, user.workspace_id, channelId);
  if (channel === null) throw notFound();
  const body = await readJsonBody(ctx);
  const messageId = body['message_id'];

  if (isUuid(messageId)) {
    const target = await queryOne<{ id: string }>(
      'SELECT id FROM messages WHERE id = $1 AND channel_id = $2 AND deleted = false',
      [messageId, channelId],
    );
    if (target === null) throw notFound();
  }
  if (!canModerate(user.role)) throw forbidden();
  if (!isUuid(messageId)) {
    const errors = new FieldErrors();
    errors.add('message_id', FIELD_COPY.pinMessageId);
    errors.throwIfAny();
  }

  const outcome = await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pins:${channelId}`]);
    const existing = await client.query<{ message_id: string }>('SELECT message_id FROM pins WHERE channel_id = $1', [
      channelId,
    ]);
    if (existing.rows.some((pin) => pin.message_id === messageId)) return 'already' as const;
    if (existing.rows.length >= LIMITS.pinsPerChannel) return 'limit' as const;
    const live = await client.query<{ id: string }>(
      'SELECT id FROM messages WHERE id = $1 AND channel_id = $2 AND deleted = false',
      [messageId, channelId],
    );
    if (live.rows[0] === undefined) return 'gone' as const;
    await client.query('INSERT INTO pins (channel_id, message_id, pinned_by, pinned_at) VALUES ($1, $2, $3, $4)', [
      channelId,
      messageId,
      user.id,
      nowDate(),
    ]);
    return 'pinned' as const;
  });

  if (outcome === 'already') throw new ApiError('already_pinned');
  if (outcome === 'limit') throw new ApiError('pin_limit');
  if (outcome === 'gone') throw notFound();

  sendJson(ctx, 201, { pinned_message_ids: await pinnedIds(channelId) });
  await notifyMessageUpdated(user.workspace_id, channelId, messageId as string);
}

async function unpinMessage(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const channelId = ctx.params['id'] as string;
  const channel = await memberChannel(user.id, user.workspace_id, channelId);
  if (channel === null) throw notFound();
  const messageId = ctx.params['messageId'] as string;
  if (!isUuid(messageId)) throw notFound();
  const pinned = await queryOne<{ message_id: string }>(
    'SELECT message_id FROM pins WHERE channel_id = $1 AND message_id = $2',
    [channelId, messageId],
  );
  if (pinned === null) throw notFound();
  if (!canModerate(user.role)) throw forbidden();
  await query('DELETE FROM pins WHERE channel_id = $1 AND message_id = $2', [channelId, messageId]);
  sendNoContent(ctx);
  await notifyMessageUpdated(user.workspace_id, channelId, messageId);
}

async function pinnedIds(channelId: string): Promise<string[]> {
  const rows = await query<{ message_id: string }>(
    'SELECT message_id FROM pins WHERE channel_id = $1 ORDER BY pinned_at ASC, message_id ASC',
    [channelId],
  );
  return rows.map((row) => row.message_id);
}

export const messageRoutes: Route[] = [
  { method: 'GET', pattern: '/api/channels/:id/messages', handler: listChannelMessages },
  { method: 'POST', pattern: '/api/channels/:id/messages', handler: handleSend, acceptsMultipart: true },
  { method: 'GET', pattern: '/api/messages/:id', handler: getMessage },
  { method: 'PATCH', pattern: '/api/messages/:id', handler: patchMessage },
  { method: 'DELETE', pattern: '/api/messages/:id', handler: deleteMessage },
  { method: 'GET', pattern: '/api/messages/:id/thread', handler: getThread },
  { method: 'GET', pattern: '/api/messages/:id/versions', handler: getVersions },
  { method: 'GET', pattern: '/api/messages/:id/receipts', handler: getReceipts },
  { method: 'POST', pattern: '/api/receipts', handler: postReceipts },
  { method: 'POST', pattern: '/api/channels/:id/pins', handler: pinMessage },
  { method: 'DELETE', pattern: '/api/channels/:id/pins/:messageId', handler: unpinMessage },
];

