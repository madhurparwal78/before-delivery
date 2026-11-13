import { serverNow } from './clock.js';
import { pool } from './db.js';
import { findConversation } from './domain/access.js';
import { conversationRecord } from './domain/conversations.js';
import { letterRecord, type LetterRow } from './domain/letters.js';
import { send } from './hub.js';

/** Sends a letter, and its conversation, to whichever participants may see it. */
export async function pushLetter(row: LetterRow): Promise<void> {
  const now = serverNow();
  const viewers = [row.sender_id, row.recipient_id];
  for (const viewerId of viewers) {
    if (viewerId === row.recipient_id && row.dropped) continue;
    send(viewerId, { type: 'letter', letter: letterRecord(row, viewerId, now) });
  }
  await pushConversation(row.conversation_id, viewers);
}

export async function pushConversation(
  conversationId: string,
  viewerIds: readonly string[],
): Promise<void> {
  const now = serverNow();
  for (const viewerId of viewerIds) {
    const access = await findConversation(pool, conversationId, viewerId);
    if (access === null) continue;
    send(viewerId, {
      type: 'conversation',
      conversation: await conversationRecord(pool, access, viewerId, now),
    });
  }
}

/** Tells an account's contacts that their identity key moved on. */
export async function pushKeyChange(accountId: string): Promise<void> {
  const contacts = await pool.query<{ conversation_id: string; account_id: string }>(
    `select s.conversation_id, s.account_id from conversation_sides s
       join conversation_sides mine on mine.conversation_id = s.conversation_id
      where mine.account_id = $1 and s.account_id <> $1`,
    [accountId],
  );
  for (const contact of contacts.rows) {
    send(contact.account_id, { type: 'keys', account_id: accountId });
    await pushConversation(contact.conversation_id, [contact.account_id]);
  }
}
