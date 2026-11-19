/**
 * The one place the derived counts are defined. Every badge and every
 * delivered or read total is a query over receipts and current membership,
 * never a stored running total.
 */

/** Recipients of a message: current channel members other than the author who joined at or before it was sent. */
export const RECIPIENTS_OF_MESSAGE = `
  SELECT cm.user_id
  FROM channel_members cm
  WHERE cm.channel_id = m.channel_id
    AND cm.user_id <> m.author_id
    AND cm.joined_at <= m.sent_at`;

export const RECIPIENT_COUNT_SQL = `(SELECT count(*)::int FROM (${RECIPIENTS_OF_MESSAGE}) AS rec)`;

export const DELIVERED_COUNT_SQL = `(
  SELECT count(*)::int FROM (${RECIPIENTS_OF_MESSAGE}) AS rec
  JOIN receipts r ON r.message_id = m.id AND r.user_id = rec.user_id
  WHERE r.delivered_at IS NOT NULL)`;

export const READ_COUNT_SQL = `(
  SELECT count(DISTINCT mr.user_id)::int FROM (${RECIPIENTS_OF_MESSAGE}) AS rec
  JOIN message_reads mr ON mr.message_id = m.id AND mr.user_id = rec.user_id)`;

export const REPLY_COUNT_SQL = `(
  SELECT count(*)::int FROM messages reply
  WHERE reply.thread_root_id = m.id AND reply.deleted = false)`;

/** Unread messages in a channel for one person. */
export const UNREAD_COUNT_SQL = `(
  SELECT count(*)::int FROM messages um
  JOIN channel_members ucm ON ucm.channel_id = um.channel_id AND ucm.user_id = $VIEWER
  WHERE um.channel_id = c.id
    AND um.deleted = false
    AND um.author_id <> $VIEWER
    AND um.sent_at >= ucm.joined_at
    AND NOT EXISTS (
      SELECT 1 FROM message_reads mr WHERE mr.message_id = um.id AND mr.user_id = $VIEWER))`;

export function unreadCountSql(viewerParam: string): string {
  return UNREAD_COUNT_SQL.replaceAll('$VIEWER', viewerParam);
}
