import type { Db } from './db';
import { ApiError } from './errors';
import type { Viewer } from './user-projection';
import { isUuid } from './validate';
import type { MessageRow } from '../shared/terms';
import type { MessageView } from './message-view';

export type FullMessageRow = MessageRow & { workspace_id: string };

export interface ChannelRow {
  id: string;
  workspace_id: string;
  name: string;
  kind: string;
  private: boolean;
}

export async function requireChannel(db: Db, channelId: string, viewer: Viewer): Promise<ChannelRow> {
  if (!isUuid(channelId)) throw new ApiError('not_found');
  const res = await db.pool.query<ChannelRow>(
    'SELECT id, workspace_id, name, kind, private FROM channels WHERE id = $1',
    [channelId],
  );
  if (res.rowCount === 0) throw new ApiError('not_found');
  const channel = res.rows[0];
  if (channel.workspace_id !== viewer.workspaceId) throw new ApiError('not_found');
  const member = await db.pool.query(
    'SELECT 1 FROM memberships WHERE channel_id = $1 AND user_id = $2',
    [channelId, viewer.id],
  );
  if (member.rowCount === 0) throw new ApiError('not_found');
  return channel;
}

export async function requireReadableMessage(db: Db, messageId: string, viewer: Viewer): Promise<FullMessageRow> {
  if (!isUuid(messageId)) throw new ApiError('not_found');
  const res = await db.pool.query<FullMessageRow>(
    `SELECT m.* FROM messages m
       JOIN channels c ON c.id = m.channel_id
      WHERE m.id = $1 AND m.deleted = false AND c.workspace_id = $2`,
    [messageId, viewer.workspaceId],
  );
  if (res.rowCount === 0) throw new ApiError('not_found');
  const row = res.rows[0];
  const member = await db.pool.query(
    'SELECT 1 FROM memberships WHERE channel_id = $1 AND user_id = $2',
    [row.channel_id, viewer.id],
  );
  if (member.rowCount === 0) throw new ApiError('not_found');
  return row;
}

export interface MessageCounts {
  recipient_count: number;
  delivered_count: number;
  read_count: number;
}

/**
 * The derived counts, always computed from receipts and current membership
 * (DP-23). Decided only here.
 */
export async function messageCounts(db: Db, messageId: string): Promise<MessageCounts> {
  const res = await db.pool.query(
    `SELECT
       (SELECT count(*)::int FROM memberships ms JOIN messages m2 ON m2.id = $1
          WHERE ms.channel_id = m2.channel_id AND ms.user_id <> m2.author_id AND ms.joined_at <= m2.sent_at) AS recipient_count,
       (SELECT count(*)::int FROM receipts r
          WHERE r.message_id = $1 AND r.delivered_at IS NOT NULL
            AND EXISTS (SELECT 1 FROM memberships ms2 JOIN messages m3 ON m3.id = $1
                         WHERE ms2.channel_id = m3.channel_id AND ms2.user_id = r.user_id AND ms2.joined_at <= m3.sent_at)) AS delivered_count,
       (SELECT count(*)::int FROM message_reads mr
          WHERE mr.message_id = $1
            AND EXISTS (SELECT 1 FROM memberships ms3 JOIN messages m4 ON m4.id = $1
                         WHERE ms3.channel_id = m4.channel_id AND ms3.user_id = mr.user_id AND ms3.joined_at <= m4.sent_at)) AS read_count`,
    [messageId],
  );
  return {
    recipient_count: res.rows[0].recipient_count,
    delivered_count: res.rows[0].delivered_count,
    read_count: res.rows[0].read_count,
  };
}

export async function unreadCountForViewer(db: Db, channelId: string, userId: string): Promise<number> {
  const res = await db.pool.query(
    `SELECT count(*)::int AS n FROM messages m
       JOIN memberships ms ON ms.channel_id = m.channel_id AND ms.user_id = $2
      WHERE m.channel_id = $1 AND m.deleted = false AND m.author_id <> $2
        AND m.sent_at >= ms.joined_at
        AND NOT EXISTS (SELECT 1 FROM message_reads mr WHERE mr.message_id = m.id AND mr.user_id = $2)`,
    [channelId, userId],
  );
  return res.rows[0].n;
}

export async function pinnedIds(db: Db, channelId: string): Promise<string[]> {
  const res = await db.pool.query<{ message_id: string }>(
    'SELECT message_id FROM pins WHERE channel_id = $1 ORDER BY pinned_at DESC',
    [channelId],
  );
  return res.rows.map((r) => r.message_id);
}

export interface AuthorRow {
  id: string;
  name: string;
  role: string;
}

export async function authorOf(db: Db, userId: string): Promise<AuthorRow> {
  const res = await db.pool.query<AuthorRow>('SELECT id, name, role FROM users WHERE id = $1', [userId]);
  return res.rows[0];
}

export function isoInstant(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Builds the public Message shape for a stored row. */
export async function buildMessageView(
  db: Db,
  row: FullMessageRow,
  editWindowSeconds: number,
): Promise<MessageView> {
  const counts = await messageCounts(db, row.id);
  const author = await authorOf(db, row.author_id);
  const pinRow = await db.pool.query<{ pinned_by: string; pinned_by_name: string }>(
    `SELECT p.pinned_by, u.name AS pinned_by_name FROM pins p JOIN users u ON u.id = p.pinned_by
      WHERE p.channel_id = $1 AND p.message_id = $2`,
    [row.channel_id, row.id],
  );
  const attachments = await db.pool.query(
    `SELECT id, filename, content_type, bytes, width, height
       FROM attachments WHERE message_id = $1 AND state = 'stored' ORDER BY uploaded_at ASC, id ASC`,
    [row.id],
  );
  let quote: Record<string, unknown> | null = null;
  if (row.quoted_message_id) {
    const q = await db.pool.query<{ id: string; author_id: string; text: string; version: number; deleted: boolean }>(
      'SELECT id, author_id, text, version, deleted FROM messages WHERE id = $1',
      [row.quoted_message_id],
    );
    if (q.rowCount === 1) {
      const quotedRow = q.rows[0];
      if (quotedRow.deleted) {
        quote = { message_id: quotedRow.id, deleted: true };
      } else {
        const quotedAuthor = await authorOf(db, quotedRow.author_id);
        quote = {
          message_id: quotedRow.id,
          author_name: quotedAuthor.name,
          text: quotedRow.text,
          edited: quotedRow.version > 1,
          deleted: false,
        };
      }
    }
  }
  const replyCount = await db.pool.query('SELECT count(*)::int AS n FROM messages WHERE thread_root_id = $1 AND deleted = false', [row.id]);
  return {
    id: row.id,
    channel_id: row.channel_id,
    client_message_id: row.client_message_id,
    author: { id: author.id, name: author.name, role: author.role },
    text: row.text,
    version: row.version,
    edited: row.version > 1,
    sent_at: isoInstant(row.sent_at),
    edited_at: row.edited_at ? isoInstant(row.edited_at) : null,
    editable_until: isoInstant(new Date(row.sent_at.getTime() + editWindowSeconds * 1000)),
    thread_root_id: row.thread_root_id,
    reply_count: replyCount.rows[0].n,
    quote,
    attachments: attachments.rows.map((a) => ({
      id: a.id,
      filename: a.filename,
      content_type: a.content_type,
      bytes: a.bytes,
      width: a.width,
      height: a.height,
      url: `/api/attachments/${a.id}`,
      thumb_url: `/api/attachments/${a.id}/thumb`,
    })),
    pinned: pinRow.rowCount !== null && pinRow.rowCount > 0,
    pinned_by: pinRow.rowCount && pinRow.rowCount > 0 ? { id: pinRow.rows[0].pinned_by, name: pinRow.rows[0].pinned_by_name } : null,
    recipient_count: counts.recipient_count,
    delivered_count: counts.delivered_count,
    read_count: counts.read_count,
    deleted: false,
  };
}
