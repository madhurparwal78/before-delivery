import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError, fieldCopy } from './errors';
import { requireViewer, canTopLevelPost } from './auth';
import type { AppServices } from './context';
import { buildMessageView, isoInstant, messageCounts, requireChannel, type FullMessageRow } from './messages-domain';
import { isUuid } from './validate';
import { logChannelEvent } from './events';
import { mentionedHandles } from './mentions';
import { checkPhotos, decodePhotos, parseSendBody, rateLimitInfo } from './send-helpers';
import { encodeCursor, parsePaging, type CursorRef } from './paging';
import { processPhoto } from './photos';
import { MAX_MESSAGE_LENGTH } from '../shared/terms';

export async function cleanupObjects(services: AppServices, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await services.storage.removeMany(keys);
  } catch {
    for (const key of keys) {
      await services.db.pool.query(
        `INSERT INTO removal_queue (workspace_id, message_id, attachment_id, object_key, queued_at)
         VALUES ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000',$1,$2)
         ON CONFLICT (object_key) DO NOTHING`,
        [key, services.clock.now()],
      );
    }
  }
}

export function registerMessageRoutes(app: FastifyInstance, services: AppServices): void {
  app.get('/api/channels/:id/messages', async (request: FastifyRequest) => {
    const viewer = await requireViewer(services.db, request);
    const channelId = (request.params as Record<string, string>).id;
    await requireChannel(services.db, channelId, viewer);
    const query = request.query as Record<string, string | undefined>;
    const { limit, cursor } = parsePaging(query);
    const params: unknown[] = [channelId];
    // A deleted top-level message with surviving replies stays as the deleted
    // placeholder; a deleted message without replies disappears (DP-42).
    let where = `m.channel_id = $1 AND m.thread_root_id IS NULL AND (m.deleted = false OR EXISTS (SELECT 1 FROM messages r WHERE r.thread_root_id = m.id AND r.deleted = false))`;
    if (cursor) {
      params.push(cursor.s, cursor.i);
      where += ` AND (m.sent_at < $${params.length - 1} OR (m.sent_at = $${params.length - 1} AND m.id < $${params.length}))`;
    }
    params.push(limit + 1);
    const res = await services.db.pool.query(
      `SELECT m.* FROM messages m WHERE ${where} ORDER BY m.sent_at DESC, m.id DESC LIMIT $${params.length}`,
      params,
    );
    const rows = res.rows as FullMessageRow[];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const messages = [];
    for (const row of page) {
      if (row.deleted) {
        const replyCount = (await services.db.pool.query(
          'SELECT count(*)::int AS n FROM messages WHERE thread_root_id = $1 AND deleted = false',
          [row.id],
        )).rows[0].n;
        messages.push({
          id: row.id,
          channel_id: row.channel_id,
          deleted: true,
          sent_at: isoInstant(row.sent_at),
          reply_count: replyCount,
        });
        continue;
      }
      messages.push(await buildMessageView(services.db, row, services.config.editWindowSeconds));
    }
    const nextCursor = hasMore && page.length > 0
      ? encodeCursor({ s: isoInstant(page[page.length - 1].sent_at), i: page[page.length - 1].id } as CursorRef)
      : null;
    return { messages, next_cursor: nextCursor };
  });

  app.post('/api/channels/:id/messages', async (request: FastifyRequest, reply: FastifyReply) => {
    const viewer = await requireViewer(services.db, request);
    const channelId = (request.params as Record<string, string>).id;
    const channel = await requireChannel(services.db, channelId, viewer);
    const { payload, unaccepted } = await parseSendBody(request);

    const errors: Record<string, string> = {};
    for (const key of unaccepted) errors[key] = fieldCopy('unaccepted');
    const text = payload.text.trim();
    if (!isUuid(payload.client_message_id)) errors.client_message_id = fieldCopy('clientMessageId');
    if (text === '' && payload.files.length === 0) errors.text = fieldCopy('textEmpty');
    if (text.length > MAX_MESSAGE_LENGTH) errors.text = fieldCopy('textTooLong');
    if (payload.thread_root_id !== null && !isUuid(payload.thread_root_id)) errors.thread_root_id = fieldCopy('threadRootId');
    if (payload.quoted_message_id !== null && !isUuid(payload.quoted_message_id)) errors.quoted_message_id = fieldCopy('quotedMessageId');
    if (Object.keys(errors).length > 0) throw new ApiError('validation', undefined, errors);

    // Repeated send: stored response, conflict or deleted, before the rate limit.
    const storedRes = await services.db.pool.query<FullMessageRow>(
      `SELECT * FROM messages WHERE author_id = $1 AND channel_id = $2 AND client_message_id = $3`,
      [viewer.id, channel.id, payload.client_message_id],
    );
    if (storedRes.rowCount === 1) {
      const row = storedRes.rows[0];
      if (row.deleted) throw new ApiError('message_deleted');
      const photoCount = await services.db.pool.query(
        `SELECT count(*)::int AS n FROM attachments WHERE message_id = $1 AND state = 'stored'`,
        [row.id],
      );
      const sameShape = row.text === text
        && row.thread_root_id === payload.thread_root_id
        && row.quoted_message_id === payload.quoted_message_id
        && photoCount.rows[0].n === payload.files.length;
      if (!sameShape) throw new ApiError('client_message_id_conflict');
      reply.header('Rimewire-Replay', 'true');
      reply.status(201);
      return { message: await buildMessageView(services.db, row, services.config.editWindowSeconds) };
    }

    if (channel.kind === 'broadcast' && !canTopLevelPost(viewer.role) && payload.thread_root_id === null) {
      throw new ApiError('broadcast_only');
    }
    if (payload.thread_root_id !== null) {
      const root = await services.db.pool.query(
        'SELECT channel_id, thread_root_id, deleted FROM messages WHERE id = $1',
        [payload.thread_root_id],
      );
      // A deleted root that still has replies is a placeholder and may take
      // more replies; one without replies is gone for good (DP-42).
      const hasReplies = root.rowCount === 1 ? (await services.db.pool.query(
        'SELECT 1 FROM messages WHERE thread_root_id = $1 AND deleted = false LIMIT 1',
        [payload.thread_root_id],
      )).rowCount : 0;
      if (root.rowCount === 0 || root.rows[0].channel_id !== channel.id
        || root.rows[0].thread_root_id !== null
        || (root.rows[0].deleted && (hasReplies ?? 0) === 0)) {
        throw new ApiError('validation', undefined, { thread_root_id: fieldCopy('threadRootId') });
      }
    }
    if (payload.quoted_message_id !== null) {
      const quoted = await services.db.pool.query(
        'SELECT channel_id, deleted FROM messages WHERE id = $1',
        [payload.quoted_message_id],
      );
      if (quoted.rowCount === 0 || quoted.rows[0].channel_id !== channel.id || quoted.rows[0].deleted) {
        throw new ApiError('validation', undefined, { quoted_message_id: fieldCopy('quotedMessageId') });
      }
    }

    // Photo pipeline: every object is written before the message row exists.
    const messageId = crypto.randomUUID();
    const writtenKeys: string[] = [];
    const attachmentMeta: {
      id: string; filename: string; contentType: string; bytes: number;
      width: number; height: number; originalKey: string; thumbKey: string;
    }[] = [];
    if (payload.files.length > 0) {
      if (!(await services.storage.check())) {
        services.storage.setAvailable(false);
        throw new ApiError('storage_unavailable');
      }
      const checked = checkPhotos(payload.files);
      if (checked instanceof ApiError) throw checked;
      const decodeError = await decodePhotos(checked);
      if (decodeError) throw decodeError;
      try {
        for (const photo of checked) {
          const processed = await processPhoto(photo.buffer, photo.format);
          const attachmentId = crypto.randomUUID();
          const originalKey = `attachments/${channel.workspace_id}/${messageId}/${attachmentId}/original`;
          const thumbKey = `attachments/${channel.workspace_id}/${messageId}/${attachmentId}/thumb.jpg`;
          await services.storage.put(originalKey, processed.original, processed.contentType);
          await services.storage.put(thumbKey, processed.thumb, 'image/jpeg');
          writtenKeys.push(originalKey, thumbKey);
          attachmentMeta.push({
            id: attachmentId,
            filename: photo.name,
            contentType: processed.contentType,
            bytes: processed.original.length,
            width: processed.width,
            height: processed.height,
            originalKey,
            thumbKey,
          });
        }
      } catch {
        await cleanupObjects(services, writtenKeys);
        services.storage.setAvailable(false);
        throw new ApiError('storage_unavailable');
      }
    }

    // Send rate: at most 20 counted sends in any rolling minute.
    const rate = await rateLimitInfo(services.db, viewer.id, services.clock.now());
    if (rate.count >= 20) {
      await cleanupObjects(services, writtenKeys);
      throw new ApiError('rate_limited', undefined, null, { 'Retry-After': String(rate.waitSeconds) });
    }

    const sentAt = services.clock.now();
    type Outcome = 'created' | 'replay' | 'conflict' | 'deleted';
    const outcome: { kind: Outcome } = { kind: 'created' };
    let storedRow: FullMessageRow | null = null;
    await services.db.tx(async (client) => {
      const inserted = await client.query<FullMessageRow>(
        `INSERT INTO messages (id, channel_id, workspace_id, client_message_id, author_id, text, version, sent_at, thread_root_id, quoted_message_id, deleted)
         VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,false)
         ON CONFLICT (author_id, channel_id, client_message_id) DO NOTHING
         RETURNING *`,
        [messageId, channel.id, channel.workspace_id, payload.client_message_id, viewer.id, text, sentAt, payload.thread_root_id, payload.quoted_message_id],
      );
      if (inserted.rowCount === 0) {
        const winner = await client.query<FullMessageRow>(
          `SELECT * FROM messages WHERE author_id = $1 AND channel_id = $2 AND client_message_id = $3`,
          [viewer.id, channel.id, payload.client_message_id],
        );
        const row = winner.rows[0];
        storedRow = row;
        if (row.deleted) {
          outcome.kind = 'deleted';
          return;
        }
        const photoCount = (await client.query(
          `SELECT count(*)::int AS n FROM attachments WHERE message_id = $1 AND state = 'stored'`,
          [row.id],
        )).rows[0].n;
        const sameShape = row.text === text
          && row.thread_root_id === payload.thread_root_id
          && row.quoted_message_id === payload.quoted_message_id
          && photoCount === payload.files.length;
        outcome.kind = sameShape ? 'replay' : 'conflict';
        return;
      }
      const row = inserted.rows[0];
      storedRow = row;
      await client.query(
        'INSERT INTO message_versions (message_id, version, text, edited_by, created_at) VALUES ($1,1,$2,$3,$4)',
        [row.id, text, viewer.id, sentAt],
      );
      const recipients = await client.query(
        'SELECT user_id FROM memberships WHERE channel_id = $1 AND user_id <> $2 AND joined_at <= $3',
        [channel.id, viewer.id, sentAt],
      );
      for (const r of recipients.rows) {
        await client.query(
          'INSERT INTO receipts (message_id, user_id, delivered_at) VALUES ($1,$2,NULL) ON CONFLICT DO NOTHING',
          [row.id, r.user_id],
        );
      }
      const wanted = mentionedHandles(text).map((h) => h.toLowerCase());
      if (wanted.length > 0) {
        const members = await client.query<{ id: string; handle: string }>(
          'SELECT u.id, u.handle FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.channel_id = $1',
          [channel.id],
        );
        for (const member of members.rows) {
          if (member.id === viewer.id) continue;
          if (wanted.includes(member.handle.toLowerCase())) {
            await client.query(
              'INSERT INTO mentions (message_id, channel_id, mentioned_user_id, created_at) VALUES ($1,$2,$3,$4)',
              [row.id, channel.id, member.id, sentAt],
            );
          }
        }
      }
      for (const meta of attachmentMeta) {
        await client.query(
          `INSERT INTO attachments (id, message_id, workspace_id, channel_id, filename, content_type, bytes, width, height, original_key, thumb_key, state, uploaded_by, uploaded_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'stored',$12,$13)`,
          [meta.id, row.id, channel.workspace_id, channel.id, meta.filename, meta.contentType, meta.bytes, meta.width, meta.height, meta.originalKey, meta.thumbKey, viewer.id, sentAt],
        );
      }
      outcome.kind = 'created';
    });

    if (outcome.kind === 'deleted') {
      await cleanupObjects(services, writtenKeys);
      throw new ApiError('message_deleted');
    }
    if (outcome.kind === 'conflict') {
      await cleanupObjects(services, writtenKeys);
      throw new ApiError('client_message_id_conflict');
    }
    if (outcome.kind === 'replay') {
      await cleanupObjects(services, writtenKeys);
      reply.header('Rimewire-Replay', 'true');
      reply.status(201);
      return { message: await buildMessageView(services.db, storedRow as unknown as FullMessageRow, services.config.editWindowSeconds) };
    }

    const row = storedRow as unknown as FullMessageRow;
    reply.status(201);
    const message = await buildMessageView(services.db, row, services.config.editWindowSeconds);
    await logChannelEvent(services.db, services.clock, 'message.created', channel.workspace_id, channel.id, { message });
    const counts = await messageCounts(services.db, row.id);
    await logChannelEvent(services.db, services.clock, 'receipts.updated', channel.workspace_id, channel.id, {
      message_id: row.id,
      channel_id: channel.id,
      ...counts,
    });
    const { announceBadgeChanges } = await import('./routes-read');
    await announceBadgeChanges(services, channel.id, channel.workspace_id, viewer.id);
    return { message };
  });
}
