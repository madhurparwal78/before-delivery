import type { Db } from '../db.js';

/** The one place the unread count is decided. */
export async function unreadCount(
  db: Db,
  conversationId: string,
  viewerId: string,
): Promise<number> {
  const result = await db.query<{ unread: string }>(
    `select count(*) as unread
       from letters l
       join conversation_sides s
         on s.conversation_id = l.conversation_id and s.account_id = l.recipient_id
      where l.conversation_id = $1
        and l.recipient_id = $2
        and l.letter_class = 'letter'
        and l.state in ('delivered', 'read')
        and l.retracted_at is null
        and l.seq > s.read_seq`,
    [conversationId, viewerId],
  );
  return Number(result.rows[0]?.unread ?? 0);
}
