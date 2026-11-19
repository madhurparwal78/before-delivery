import { now } from '../clock.js';
import { config } from '../config.js';
import { lockKey, maybeRow, oneRow, rows, type Db, type Tx, publishAfterCommit } from '../db.js';
import { forbidden, notFound, validation } from '../errors.js';
import { newId } from '../ids.js';
import { queueMail } from '../mail.js';
import { lockPair } from './connections.js';
import { unreadMessagesSql } from './counts.js';
import { showsPhotoSql } from './media.js';
import { decodeCursor, encodeCursor } from './page.js';
import { checkedText } from './text.js';
import { connectedWith, memberVisibleTo, notBlockedWith } from './visibility.js';

interface ConversationSummary {
  id: string;
  other: { id: string; name: string; handle: string; photo_url: string | null };
  last_message: { text: string; sent_at: Date; sender_id: string };
  unread_count: number;
}

interface MessageRow {
  id: string;
  sender_id: string;
  text: string;
  sent_at: Date;
  read_at: Date | null;
}

interface ConversationRow {
  id: string;
  member_lo: string;
  member_hi: string;
}

const otherOf = (conversation: ConversationRow, viewerId: string): string =>
  conversation.member_lo === viewerId ? conversation.member_hi : conversation.member_lo;

/** The conversation, only for its two members and only while no block exists between them. */
export async function conversationFor(db: Db, viewerId: string, conversationId: string): Promise<ConversationRow> {
  const conversation = await maybeRow<ConversationRow>(
    db,
    `SELECT c.id, c.member_lo, c.member_hi FROM conversations c
      WHERE c.id = $1 AND $2 IN (c.member_lo, c.member_hi)
        AND ${notBlockedWith('$2', `(CASE WHEN c.member_lo = $2 THEN c.member_hi ELSE c.member_lo END)`)}`,
    [conversationId, viewerId],
  );
  if (!conversation) throw notFound();
  return conversation;
}

async function requireConnected(db: Db, viewerId: string, otherId: string): Promise<void> {
  const { connected } = await oneRow<{ connected: boolean }>(db, `SELECT ${connectedWith('$1', '$2')} AS connected`, [viewerId, otherId]);
  if (!connected) throw forbidden('not_connected');
}

/** Opens the conversation with a member: the existing one, or a new one when the two are connected. */
export async function openConversation(tx: Tx, viewerId: string, memberId: string): Promise<{ id: string; created: boolean }> {
  const target = await maybeRow(tx, `SELECT 1 FROM members m WHERE m.id = $2 AND m.confirmed AND ${memberVisibleTo('$1', 'm')}`, [viewerId, memberId]);
  if (!target) throw notFound();
  const [lo, hi] = viewerId < memberId ? [viewerId, memberId] : [memberId, viewerId];
  await lockKey(tx, `conversation:${lo}:${hi}`);
  const existing = await maybeRow<{ id: string }>(tx, 'SELECT id FROM conversations WHERE member_lo = $1 AND member_hi = $2', [lo, hi]);
  if (existing) return { id: existing.id, created: false };
  await requireConnected(tx, viewerId, memberId);
  const id = newId();
  await tx.query('INSERT INTO conversations (id, member_lo, member_hi, created_at) VALUES ($1, $2, $3, $4)', [id, lo, hi, now()]);
  return { id, created: true };
}

export async function listConversations(db: Db, viewerId: string): Promise<ConversationSummary[]> {
  const found = await rows<{
    id: string;
    other_id: string;
    name: string;
    handle: string;
    photo_url: string | null;
    text: string;
    sent_at: Date;
    sender_id: string;
    unread_count: number;
  }>(
    db,
    `SELECT c.id, o.id AS other_id, o.name, o.handle,
            CASE WHEN o.photo_id IS NOT NULL AND ${showsPhotoSql('o')}
                 THEN '/media/photos/' || o.photo_id END AS photo_url,
            lm.text, lm.sent_at, lm.sender_id,
            ${unreadMessagesSql('c', '$1')} AS unread_count
       FROM conversations c
       JOIN members o ON o.id = CASE WHEN c.member_lo = $1 THEN c.member_hi ELSE c.member_lo END
       JOIN LATERAL (SELECT text, sent_at, sender_id, seq FROM messages WHERE conversation_id = c.id ORDER BY sent_at DESC, seq DESC LIMIT 1) lm ON true
      WHERE $1 IN (c.member_lo, c.member_hi) AND ${notBlockedWith('$1', 'o.id')}
      ORDER BY lm.sent_at DESC, lm.seq DESC`,
    [viewerId],
  );
  return found.map((row) => ({
    id: row.id,
    other: { id: row.other_id, name: row.name, handle: row.handle, photo_url: row.photo_url },
    last_message: { text: row.text, sent_at: row.sent_at, sender_id: row.sender_id },
    unread_count: row.unread_count,
  }));
}

export async function messagePage(db: Db, conversationId: string, before: string | null): Promise<{ messages: MessageRow[]; next_cursor: string | null }> {
  const cursor = before === null ? null : decodeCursor<[string, number]>(before);
  if (cursor !== null && (!Array.isArray(cursor) || typeof cursor[0] !== 'string' || typeof cursor[1] !== 'number' || Number.isNaN(Date.parse(cursor[0])))) {
    throw validation({ before: 'This cursor is not valid.' });
  }
  const found = await rows<MessageRow & { seq: number }>(
    db,
    `SELECT id, sender_id, text, sent_at, read_at, seq FROM messages
      WHERE conversation_id = $1 AND ($2::timestamptz IS NULL OR (sent_at, seq) < ($2::timestamptz, $3::bigint))
      ORDER BY sent_at DESC, seq DESC LIMIT $4`,
    [conversationId, cursor ? new Date(cursor[0]) : null, cursor ? cursor[1] : null, config.messagePageSize + 1],
  );
  const more = found.length > config.messagePageSize;
  const page = found.slice(0, config.messagePageSize);
  const oldest = page[page.length - 1];
  return {
    messages: page.reverse().map(({ seq: _seq, ...message }) => message),
    next_cursor: more && oldest ? encodeCursor([oldest.sent_at.toISOString(), oldest.seq]) : null,
  };
}

/** Stores a message from a connected member; the first one of a conversation emails the recipient once. */
export async function sendMessage(tx: Tx, sender: { id: string; name: string }, conversation: ConversationRow, body: unknown): Promise<MessageRow> {
  const recipientId = otherOf(conversation, sender.id);
  await lockPair(tx, sender.id, recipientId);
  if (!(await maybeRow(tx, `SELECT 1 WHERE ${notBlockedWith('$1', '$2')}`, [sender.id, recipientId]))) throw notFound();
  await requireConnected(tx, sender.id, recipientId);
  const text = checkedText((body as { text?: unknown }).text, config.messageMaxChars, `Messages can be up to ${config.messageMaxChars} characters.`);
  await lockKey(tx, `conversation-messages:${conversation.id}`);
  const first = !(await maybeRow(tx, 'SELECT 1 FROM messages WHERE conversation_id = $1', [conversation.id]));
  const message: MessageRow = { id: newId(), sender_id: sender.id, text, sent_at: now(), read_at: null };
  await tx.query('INSERT INTO messages (id, conversation_id, sender_id, text, sent_at) VALUES ($1, $2, $3, $4, $5)', [message.id, conversation.id, sender.id, text, message.sent_at]);
  if (first) {
    const recipient = await oneRow<{ email: string }>(tx, 'SELECT email FROM members WHERE id = $1', [recipientId]);
    await queueMail(tx, {
      to: recipient.email,
      subject: `${sender.name} sent you a message`,
      text: `${sender.name} sent you a message on Plainwork.\n\nOpen Messaging to read it and reply.\n`,
    });
  }
  publishAfterCommit(tx, [sender.id, recipientId], { type: 'message', conversation_id: conversation.id, message_id: message.id, sender_id: sender.id });
  return message;
}

/** Marks the viewer's unread incoming messages up to a message as read, from the business clock. */
export async function markRead(tx: Tx, viewerId: string, conversation: ConversationRow, upTo: unknown): Promise<number> {
  if (typeof upTo !== 'string' || upTo === '') throw validation({ up_to: 'Choose a message.' });
  const target = await maybeRow<{ sent_at: Date; seq: number }>(tx, 'SELECT sent_at, seq FROM messages WHERE id = $1 AND conversation_id = $2', [upTo, conversation.id]);
  if (!target) throw notFound();
  const marked = await tx.query(
    `UPDATE messages SET read_at = $4
      WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL AND (sent_at, seq) <= ($3::timestamptz, $5::bigint)`,
    [conversation.id, viewerId, target.sent_at, now(), target.seq],
  );
  if (marked.rowCount) publishAfterCommit(tx, [viewerId, otherOf(conversation, viewerId)], { type: 'read', conversation_id: conversation.id });
  const { unread } = await oneRow<{ unread: number }>(tx, `SELECT ${unreadMessagesSql('c', '$2')} AS unread FROM conversations c WHERE c.id = $1`, [conversation.id, viewerId]);
  return unread;
}

/** A typing signal goes to the other participant; only connected members may send one. */
export async function signalTyping(tx: Tx, viewerId: string, conversation: ConversationRow): Promise<void> {
  const otherId = otherOf(conversation, viewerId);
  await requireConnected(tx, viewerId, otherId);
  publishAfterCommit(tx, [otherId], { type: 'typing', conversation_id: conversation.id, member_id: viewerId });
}
