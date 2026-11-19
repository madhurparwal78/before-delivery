import { queryOne } from '../db';
import { notFound } from '../errors';
import { MESSAGE_COLUMNS, MESSAGE_FROM, type MessageRow } from './messages';
import type { SessionUser } from '../http/context';

/**
 * A message inside the caller's workspace, in a channel they currently belong
 * to. Anything else — unknown, foreign or out of reach — is not found.
 */
export async function readableMessageRow(
  user: SessionUser,
  messageId: string,
  allowDeleted = false,
): Promise<MessageRow> {
  const row = await queryOne<MessageRow>(
    `SELECT ${MESSAGE_COLUMNS} ${MESSAGE_FROM}
     JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = $1
     WHERE m.id = $2 AND m.workspace_id = $3`,
    [user.id, messageId, user.workspace_id],
  );
  if (row === null) throw notFound();
  if (row.deleted && !allowDeleted) throw notFound();
  return row;
}
