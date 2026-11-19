// Derived counts, computed from receipts and current membership on every read; never stored.
// Recipients of a message: current channel members other than the author who joined at or
// before it was sent.

const RECIPIENT = (m: string) =>
  `rc.channel_id = ${m}.channel_id AND rc.user_id <> ${m}.author_id AND rc.joined_at <= ${m}.sent_at`;

export function messageCountColumns(m: string): string {
  return `
    (SELECT count(*)::int FROM memberships rc WHERE ${RECIPIENT(m)}) AS recipient_count,
    (SELECT count(*)::int FROM memberships rc
       JOIN deliveries d ON d.message_id = ${m}.id AND d.user_id = rc.user_id AND d.delivered_at IS NOT NULL
      WHERE ${RECIPIENT(m)}) AS delivered_count,
    (SELECT count(*)::int FROM memberships rc
      WHERE ${RECIPIENT(m)} AND EXISTS (SELECT 1 FROM reads r WHERE r.message_id = ${m}.id AND r.user_id = rc.user_id)) AS read_count`;
}

// Recipients rows for the receipts timeline, using the same recipient rule.
export function recipientsJoin(m: string): string {
  return `memberships rc JOIN users ru ON ru.id = rc.user_id WHERE ${RECIPIENT(m)}`;
}

// Unread for a person in a channel: live messages by others, sent since they joined, unread.
export function unreadColumn(channel: string, user: string): string {
  return `(SELECT count(*)::int FROM messages um
             JOIN memberships me ON me.channel_id = um.channel_id AND me.user_id = ${user}
            WHERE um.channel_id = ${channel}.id AND um.deleted_at IS NULL AND um.author_id <> ${user}
              AND um.sent_at >= me.joined_at
              AND NOT EXISTS (SELECT 1 FROM reads r WHERE r.message_id = um.id AND r.user_id = ${user})) AS unread_count`;
}
