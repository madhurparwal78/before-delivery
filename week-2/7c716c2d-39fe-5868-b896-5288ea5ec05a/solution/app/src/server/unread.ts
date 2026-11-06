// Unread counts, derived from stored messages and read markers on every read and never kept as
// totals. This is the one definition of "unread" for badges, the inbox and the digest.
import type { Db } from "./db.js";
import { emit, lockEvents } from "./events.js";

/** Messages in the person's inbox: unread, not their own, and mentioning them or answering a
 * thread they wrote in. `$1` is the person. */
const INBOX = `
  FROM messages m
  JOIN channel_members c ON c.channel_id = m.channel_id AND c.person_id = $1
  LEFT JOIN read_markers r ON r.person_id = $1 AND r.channel_id = m.channel_id
  LEFT JOIN thread_markers t ON t.person_id = $1 AND t.root_id = m.thread_root_id
  WHERE m.author_id <> $1
    AND (
      (m.thread_root_id IS NULL AND m.id > COALESCE(r.up_to, 0)
        AND EXISTS (SELECT 1 FROM message_mentions x WHERE x.message_id = m.id AND x.person_id = $1))
      OR (m.thread_root_id IS NOT NULL AND m.id > COALESCE(t.up_to, 0)
        AND (EXISTS (SELECT 1 FROM message_mentions x WHERE x.message_id = m.id AND x.person_id = $1)
             OR EXISTS (SELECT 1 FROM messages w WHERE w.author_id = $1
                          AND (w.id = m.thread_root_id OR (w.thread_root_id = m.thread_root_id AND w.id < m.id)))))
    )`;

type UnreadBody = {
  channels: Record<string, number>;
  inbox: number;
};

export async function unreadBody(db: Db, personId: string): Promise<UnreadBody> {
  const { rows } = await db.query<{ channel_id: string; n: number }>(
    `SELECT c.channel_id,
            (SELECT count(*)::int FROM messages m
             WHERE m.channel_id = c.channel_id AND m.thread_root_id IS NULL AND m.author_id <> $1 AND m.id > COALESCE(r.up_to, 0)) AS n
     FROM channel_members c LEFT JOIN read_markers r ON r.person_id = c.person_id AND r.channel_id = c.channel_id
     WHERE c.person_id = $1`,
    [personId],
  );
  const inbox = await db.query<{ n: number }>(`SELECT count(*)::int AS n ${INBOX}`, [personId]);
  return { channels: Object.fromEntries(rows.map((r) => [r.channel_id, r.n])), inbox: inbox.rows[0]?.n ?? 0 };
}

export async function inboxMessageIds(db: Db, personId: string): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(`SELECT m.id ${INBOX} ORDER BY m.id DESC`, [personId]);
  return rows.map((r) => r.id);
}

/** Sends each person a fresh `unread` event with their current counts. */
export async function emitUnread(db: Db, workspaceId: string, personIds: Iterable<string>): Promise<void> {
  await lockEvents(db, workspaceId);
  for (const personId of new Set(personIds)) {
    await emit(db, workspaceId, "unread", await unreadBody(db, personId), { recipients: [personId] });
  }
}
