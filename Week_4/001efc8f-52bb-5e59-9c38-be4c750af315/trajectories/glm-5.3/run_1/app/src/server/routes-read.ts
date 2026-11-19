import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError, fieldCopy } from './errors';
import { requireViewer } from './auth';
import type { AppServices } from './context';
import { acceptedFields } from './routes-session';
import { buildChannelView } from './channels-domain';
import { buildMessageView, isoInstant, messageCounts, requireChannel, requireReadableMessage, type FullMessageRow } from './messages-domain';
import { canEditAnyone, canSeeReceipts } from './auth';
import { isUuid } from './validate';
import { logChannelEvent, logPersonalEvent } from './events';
import { encodeCursor, parsePaging } from './paging';
import { PIN_LIMIT } from '../shared/terms';

export async function announceBadgeChanges(
  services: AppServices,
  channelId: string,
  workspaceId: string,
  exceptUserId: string,
): Promise<void> {
  const members = await services.db.pool.query(
    'SELECT user_id FROM memberships WHERE channel_id = $1',
    [channelId],
  );
  const channelRow = await services.db.pool.query(
    'SELECT id, workspace_id, name, kind, private FROM channels WHERE id = $1',
    [channelId],
  );
  for (const member of members.rows) {
    const view = await buildChannelView(services.db, channelRow.rows[0], member.user_id);
    await logPersonalEvent(services.db, services.clock, 'channel.updated', workspaceId, member.user_id, { channel: view });
  }
  void exceptUserId;
}

export function registerMessageReadRoutes(app: FastifyInstance, services: AppServices): void {
  app.get('/api/messages/:id', async (request: FastifyRequest) => {
    const viewer = await requireViewer(services.db, request);
    const row = await requireReadableMessage(services.db, (request.params as Record<string, string>).id, viewer);
    return { message: await buildMessageView(services.db, row, services.config.editWindowSeconds) };
  });

  app.patch('/api/messages/:id', async (request: FastifyRequest) => {
    const viewer = await requireViewer(services.db, request);
    const messageId = (request.params as Record<string, string>).id;
    const row = await requireReadableMessage(services.db, messageId, viewer);
    const body = request.body as Record<string, unknown> | null ?? {};
    const unaccepted = acceptedFields(body, ['text', 'expected_version']);
    const textRaw = typeof body.text === 'string' ? body.text : undefined;
    const expectedVersion = body.expected_version;
    const errors: Record<string, string> = {};
    for (const key of unaccepted) errors[key] = fieldCopy('unaccepted');
    if (textRaw === undefined || textRaw.trim() === '') errors.text = fieldCopy('textEmpty');
    else if (textRaw.trim().length > 4000) errors.text = fieldCopy('textTooLong');
    if (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion)) {
      errors.expected_version = fieldCopy('expectedVersion');
    }
    if (Object.keys(errors).length > 0) throw new ApiError('validation', undefined, errors);

    const allowed = row.author_id === viewer.id || canEditAnyone(viewer.role);
    if (!allowed) throw new ApiError('forbidden');

    // stale_version comes before other 409s in the precedence, so it is judged
    // before the edit window.
    if (expectedVersion !== row.version) {
      const editor = await services.db.pool.query(
        'SELECT v.version, v.text, v.edited_by, u.name AS editor_name, v.created_at FROM message_versions v JOIN users u ON u.id = v.edited_by WHERE v.message_id = $1 ORDER BY v.version DESC LIMIT 1',
        [row.id],
      );
      const current = editor.rows[0];
      const err = new ApiError('stale_version');
      err.extra = { current: {
        version: current.version,
        text: current.text,
        edited_by: { id: current.edited_by, name: current.editor_name },
        edited_at: isoInstant(current.created_at),
      } };
      throw err;
    }
    const editableUntil = new Date(row.sent_at.getTime() + services.config.editWindowSeconds * 1000);
    if (services.clock.now().getTime() >= editableUntil.getTime()) {
      throw new ApiError('edit_window_closed');
    }

    const text = (textRaw ?? '').trim();
    const editedAt = services.clock.now();
    const updated = await services.db.tx(async (client) => {
      const res = await client.query<FullMessageRow>(
        `UPDATE messages SET text = $2, version = version + 1, edited_at = $3
          WHERE id = $1 AND version = $4 RETURNING *`,
        [row.id, text, editedAt, expectedVersion],
      );
      if (res.rowCount === 0) return null;
      const newRow = res.rows[0];
      await client.query(
        'INSERT INTO message_versions (message_id, version, text, edited_by, created_at) VALUES ($1,$2,$3,$4,$5)',
        [row.id, newRow.version, text, viewer.id, editedAt],
      );
      return newRow;
    });
    if (!updated) {
      const fresh = await services.db.pool.query<FullMessageRow>(
        'SELECT * FROM messages WHERE id = $1 AND deleted = false',
        [row.id],
      );
      if (fresh.rowCount === 0) throw new ApiError('not_found');
      const currentRow = fresh.rows[0];
      const currentVersion = await services.db.pool.query(
        'SELECT v.version, v.text, v.edited_by, u.name AS editor_name, v.created_at FROM message_versions v JOIN users u ON u.id = v.edited_by WHERE v.message_id = $1 ORDER BY v.version DESC LIMIT 1',
        [row.id],
      );
      const current = currentVersion.rows[0];
      const err = new ApiError('stale_version');
      err.extra = { current: {
        version: current.version,
        text: current.text,
        edited_by: { id: current.edited_by, name: current.editor_name },
        edited_at: isoInstant(current.created_at),
      } };
      throw err;
    }
    const message = await buildMessageView(services.db, updated, services.config.editWindowSeconds);
    await logChannelEvent(services.db, services.clock, 'message.updated', row.workspace_id, row.channel_id, { message });
    return { message };
  });

  app.delete('/api/messages/:id', async (request: FastifyRequest, reply: { status: (code: number) => void }) => {
    const viewer = await requireViewer(services.db, request);
    const messageId = (request.params as Record<string, string>).id;
    const row = await requireReadableMessage(services.db, messageId, viewer);
    const allowed = row.author_id === viewer.id || canEditAnyone(viewer.role);
    if (!allowed) throw new ApiError('forbidden');

    const attachments = await services.db.pool.query(
      'SELECT id, original_key, thumb_key FROM attachments WHERE message_id = $1 AND state = $2',
      [row.id, 'stored'],
    );
    await services.db.tx(async (client) => {
      const del = await client.query('UPDATE messages SET deleted = true WHERE id = $1 AND deleted = false RETURNING id', [row.id]);
      if (!del.rowCount || del.rowCount === 0) throw new ApiError('not_found');
      await client.query('DELETE FROM message_versions WHERE message_id = $1', [row.id]);
      await client.query('DELETE FROM receipts WHERE message_id = $1', [row.id]);
      await client.query('DELETE FROM message_reads WHERE message_id = $1', [row.id]);
      await client.query('DELETE FROM mentions WHERE message_id = $1', [row.id]);
      await client.query('DELETE FROM pins WHERE message_id = $1', [row.id]);
      await client.query(`UPDATE attachments SET state = 'removal_queued' WHERE message_id = $1`, [row.id]);
      for (const a of attachments.rows) {
        await client.query(
          `INSERT INTO removal_queue (workspace_id, message_id, attachment_id, object_key, queued_at)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (object_key) DO NOTHING`,
          [row.workspace_id, row.id, a.id, a.original_key, services.clock.now()],
        );
        await client.query(
          `INSERT INTO removal_queue (workspace_id, message_id, attachment_id, object_key, queued_at)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (object_key) DO NOTHING`,
          [row.workspace_id, row.id, a.id, a.thumb_key, services.clock.now()],
        );
      }
    });
    await logChannelEvent(services.db, services.clock, 'message.deleted', row.workspace_id, row.channel_id, {
      message_id: row.id,
      channel_id: row.channel_id,
    });
    // Best-effort immediate removal; anything left stays queued.
    const keys = attachments.rows.flatMap((a: { original_key: string; thumb_key: string }) => [a.original_key, a.thumb_key]);
    try {
      await services.storage.removeMany(keys);
      await services.db.pool.query(
        `UPDATE attachments SET state = 'removed' WHERE message_id = $1 AND state = 'removal_queued'`,
        [row.id],
      );
      await services.db.pool.query('DELETE FROM removal_queue WHERE message_id = $1', [row.id]);
    } catch {
      services.storage.setAvailable(false);
    }
    reply.status(204);
    return null;
  });

  app.get('/api/messages/:id/thread', async (request: FastifyRequest) => {
    const viewer = await requireViewer(services.db, request);
    const messageId = (request.params as Record<string, string>).id;
    if (!isUuid(messageId)) throw new ApiError('not_found');
    // The root may be deleted; its replies must stay reachable through the
    // deleted placeholder (DP-42).
    const rootRes = await services.db.pool.query<FullMessageRow>(
      `SELECT m.* FROM messages m
         JOIN channels c ON c.id = m.channel_id
        WHERE m.id = $1 AND c.workspace_id = $2`,
      [messageId, viewer.workspaceId],
    );
    if (rootRes.rowCount === 0) throw new ApiError('not_found');
    const rootRow = rootRes.rows[0];
    if (rootRow.thread_root_id !== null) throw new ApiError('not_found');
    const member = await services.db.pool.query(
      'SELECT 1 FROM memberships WHERE channel_id = $1 AND user_id = $2',
      [rootRow.channel_id, viewer.id],
    );
    if (member.rowCount === 0) throw new ApiError('not_found');

    const query = request.query as Record<string, string | undefined>;
    const { limit, cursor } = parsePaging(query);
    const params: unknown[] = [rootRow.id];
    let where = 'm.thread_root_id = $1 AND m.deleted = false';
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
    const replies = [];
    for (const r of page) replies.push(await buildMessageView(services.db, r, services.config.editWindowSeconds));
    const replyCount = (await services.db.pool.query(
      'SELECT count(*)::int AS n FROM messages WHERE thread_root_id = $1 AND deleted = false',
      [rootRow.id],
    )).rows[0].n;
    const rootView = rootRow.deleted
      ? {
          id: rootRow.id,
          channel_id: rootRow.channel_id,
          deleted: true,
          sent_at: isoInstant(rootRow.sent_at),
          reply_count: replyCount,
        }
      : await buildMessageView(services.db, rootRow, services.config.editWindowSeconds);
    const nextCursor = hasMore && page.length > 0 ? encodeCursor({ s: isoInstant(page[page.length - 1].sent_at), i: page[page.length - 1].id }) : null;
    return {
      root: rootView,
      replies,
      next_cursor: nextCursor,
    };
  });

  app.get('/api/messages/:id/versions', async (request: FastifyRequest) => {
    const viewer = await requireViewer(services.db, request);
    const messageId = (request.params as Record<string, string>).id;
    const row = await requireReadableMessage(services.db, messageId, viewer);
    const res = await services.db.pool.query(
      `SELECT v.version, v.text, v.edited_by, u.name AS editor_name, v.created_at
         FROM message_versions v JOIN users u ON u.id = v.edited_by
        WHERE v.message_id = $1 ORDER BY v.version ASC`,
      [row.id],
    );
    return {
      versions: res.rows.map((v: { version: number; text: string; edited_by: string; editor_name: string; created_at: Date }) => ({
        version: v.version,
        text: v.text,
        edited_by: { id: v.edited_by, name: v.editor_name },
        created_at: isoInstant(v.created_at),
      })),
    };
  });

  app.get('/api/messages/:id/receipts', async (request: FastifyRequest) => {
    const viewer = await requireViewer(services.db, request);
    const messageId = (request.params as Record<string, string>).id;
    const row = await requireReadableMessage(services.db, messageId, viewer);
    if (row.author_id !== viewer.id && !canSeeReceipts(viewer.role)) throw new ApiError('forbidden');
    const versions = await services.db.pool.query(
      `SELECT v.version, v.text, v.edited_by, u.name AS editor_name, v.created_at
         FROM message_versions v JOIN users u ON u.id = v.edited_by
        WHERE v.message_id = $1 ORDER BY v.version ASC`,
      [row.id],
    );
    const recipients = await services.db.pool.query(
      `SELECT u.id, u.name, r.delivered_at FROM receipts r JOIN users u ON u.id = r.user_id
        WHERE r.message_id = $1 AND EXISTS (
          SELECT 1 FROM memberships ms WHERE ms.channel_id = $2 AND ms.user_id = u.id AND ms.joined_at <= $3)
        ORDER BY u.name`,
      [row.id, row.channel_id, row.sent_at],
    );
    const reads = await services.db.pool.query(
      `SELECT mr.user_id, mr.version, mr.read_at FROM message_reads mr
        WHERE mr.message_id = $1`,
      [row.id],
    );
    const readMap = new Map<string, { version: number; read_at: Date }[]>();
    for (const r of reads.rows) {
      const list = readMap.get(r.user_id) ?? [];
      list.push({ version: r.version, read_at: r.read_at });
      readMap.set(r.user_id, list);
    }
    const counts = await messageCounts(services.db, row.id);
    return {
      message_id: row.id,
      sent_at: isoInstant(row.sent_at),
      as_of: isoInstant(services.clock.now()),
      versions: versions.rows.map((v: { version: number; text: string; edited_by: string; editor_name: string; created_at: Date }) => ({
        version: v.version,
        text: v.text,
        edited_by: { id: v.edited_by, name: v.editor_name },
        created_at: isoInstant(v.created_at),
      })),
      recipients: recipients.rows.map((r: { id: string; name: string; delivered_at: Date | null }) => ({
        user: { id: r.id, name: r.name },
        delivered_at: r.delivered_at ? isoInstant(r.delivered_at) : null,
        reads: (readMap.get(r.id) ?? []).sort((a, b) => a.version - b.version).map((rd) => ({ version: rd.version, read_at: isoInstant(rd.read_at) })),
      })),
      recipient_count: counts.recipient_count,
      delivered_count: counts.delivered_count,
      read_count: counts.read_count,
    };
  });

  app.post('/api/receipts', async (request: FastifyRequest) => {
    const viewer = await requireViewer(services.db, request);
    const body = request.body as Record<string, unknown> | null ?? {};
    const errors: Record<string, string> = {};
    for (const key of acceptedFields(body, ['message_ids', 'state'])) errors[key] = fieldCopy('unaccepted');
    const ids = Array.isArray(body.message_ids) ? body.message_ids : null;
    const state = body.state;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || !ids.every((id) => typeof id === 'string' && isUuid(id))) {
      errors.message_ids = fieldCopy('messageIds');
    }
    if (state !== 'delivered' && state !== 'read') errors.state = fieldCopy('state');
    if (Object.keys(errors).length > 0) throw new ApiError('validation', undefined, errors);

    const validIds = ids as string[];
    const rows = await services.db.pool.query(
      `SELECT m.id, m.channel_id, m.author_id, m.version, m.workspace_id FROM messages m
        WHERE m.id = ANY($1::uuid[]) AND m.deleted = false`,
      [validIds],
    );
    const readable = new Map<string, { channel_id: string; author_id: string; version: number; workspace_id: string }>();
    for (const row of rows.rows) readable.set(row.id, row);
    const memberships = await services.db.pool.query(
      'SELECT channel_id FROM memberships WHERE user_id = $1',
      [viewer.id],
    );
    const memberSet = new Set(memberships.rows.map((m: { channel_id: string }) => m.channel_id));
    for (const id of validIds) {
      const info = readable.get(id);
      if (!info || !memberSet.has(info.channel_id)) throw new ApiError('not_found');
    }
    const now = services.clock.now();
    let updated = 0;
    for (const id of validIds) {
      const info = readable.get(id);
      if (info && info.author_id === viewer.id) continue;
      if (state === 'delivered') {
        const res = await services.db.pool.query(
          'UPDATE receipts SET delivered_at = $3 WHERE message_id = $1 AND user_id = $2 AND delivered_at IS NULL',
          [id, viewer.id, now],
        );
        updated += res.rowCount ?? 0;
      } else {
        const versionRow = await services.db.pool.query('SELECT version FROM messages WHERE id = $1', [id]);
        const version = versionRow.rows[0].version;
        const resRead = await services.db.pool.query(
          `INSERT INTO message_reads (message_id, user_id, version, read_at) VALUES ($1,$2,$3,$4)
           ON CONFLICT (message_id, user_id, version) DO NOTHING`,
          [id, viewer.id, version, now],
        );
        updated += resRead.rowCount ?? 0;
        await services.db.pool.query(
          'UPDATE receipts SET delivered_at = COALESCE(delivered_at, $3) WHERE message_id = $1 AND user_id = $2',
          [id, viewer.id, now],
        );
      }
    }
    for (const id of validIds) {
      const info = readable.get(id);
      if (!info) continue;
      const counts = await messageCounts(services.db, id);
      await logChannelEvent(services.db, services.clock, 'receipts.updated', info.workspace_id, info.channel_id, {
        message_id: id,
        channel_id: info.channel_id,
        ...counts,
      });
      await announceBadgeChanges(services, info.channel_id, info.workspace_id, viewer.id);
    }
    return { updated };
  });
}
