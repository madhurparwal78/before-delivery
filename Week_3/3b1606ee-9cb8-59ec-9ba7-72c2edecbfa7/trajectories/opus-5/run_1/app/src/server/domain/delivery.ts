import type { LetterClass } from '../../shared/types.js';
import { RETURN_AFTER_MS } from '../config.js';
import type { Db } from '../db.js';
import { LETTER_COLUMNS, letterColumns, type LetterRow } from './letters.js';

/** The one place every letter delivery state change is decided. */

export interface PostLetterInput {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  letterClass: LetterClass;
  senderKeyId: string;
  recipientKeyId: string;
  iv: string;
  ciphertext: string;
  attachmentId: string | null;
  /** A letter posted to someone who has blocked the sender is never queued. */
  dropped: boolean;
  now: Date;
}

export async function postLetter(db: Db, input: PostLetterInput): Promise<LetterRow> {
  const result = await db.query<LetterRow>(
    `insert into letters (id, conversation_id, sender_id, recipient_id, letter_class, state,
       held_at, sender_key_id, recipient_key_id, iv, ciphertext, attachment_id, dropped)
     values ($1, $2, $3, $4, $5, 'sent', $6, $7, $8, $9, $10, $11, $12)
     returning ${LETTER_COLUMNS}`,
    [
      input.id,
      input.conversationId,
      input.senderId,
      input.recipientId,
      input.letterClass,
      input.now,
      input.senderKeyId,
      input.recipientKeyId,
      input.dropped ? null : input.iv,
      input.dropped ? null : input.ciphertext,
      input.attachmentId,
      input.dropped,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('letter insert returned no row');

  await db.query('update conversations set updated_at = $2 where id = $1', [
    input.conversationId,
    input.now,
  ]);
  if (!input.dropped) {
    await db.query(
      'update conversation_sides set visible = true where conversation_id = $1 and account_id = $2',
      [input.conversationId, input.recipientId],
    );
  }
  return row;
}

/** sent -> delivered, for every held letter the recipient acks. */
export async function markDelivered(
  db: Db,
  recipientId: string,
  throughSeq: number,
  now: Date,
): Promise<LetterRow[]> {
  const result = await db.query<LetterRow>(
    `update letters l
        set state = 'delivered', delivered_at = $3, iv = null, ciphertext = null
       from conversation_sides s
      where s.conversation_id = l.conversation_id
        and s.account_id = l.recipient_id
        and l.recipient_id = $1
        and l.seq <= $2
        and l.seq > s.hide_seq
        and l.state = 'sent'
        and l.retracted_at is null
        and not l.dropped
      returning ${letterColumns('l')}`,
    [recipientId, throughSeq, now],
  );
  return result.rows;
}

/** delivered -> read, when the marker covers it and both people have receipts on. */
export async function markRead(
  db: Db,
  conversationId: string,
  viewerId: string,
  now: Date,
): Promise<LetterRow[]> {
  const guard = await db.query<{ receipts: boolean }>(
    `select (viewer.read_receipts and peer.read_receipts) as receipts
       from conversation_sides s
       join accounts viewer on viewer.id = s.account_id
       join conversations c on c.id = s.conversation_id
       join accounts peer on peer.id = case when c.peer_a = s.account_id then c.peer_b else c.peer_a end
      where s.conversation_id = $1 and s.account_id = $2 and s.accepted`,
    [conversationId, viewerId],
  );
  if (guard.rows[0]?.receipts !== true) return [];

  const result = await db.query<LetterRow>(
    `update letters l
        set state = 'read', read_at = $3
       from conversation_sides s
      where s.conversation_id = l.conversation_id
        and s.account_id = l.recipient_id
        and l.conversation_id = $1
        and l.recipient_id = $2
        and l.seq <= s.read_seq
        and l.state = 'delivered'
        and l.retracted_at is null
      returning ${letterColumns('l')}`,
    [conversationId, viewerId, now],
  );
  return result.rows;
}

/** sent -> failed/returned, 30 days after held_at without an ack. */
export async function markReturned(db: Db, now: Date): Promise<LetterRow[]> {
  const cutoff = new Date(now.getTime() - RETURN_AFTER_MS);
  const result = await db.query<LetterRow>(
    `update letters
        set state = 'failed', failure = 'returned', returned_at = $1, iv = null, ciphertext = null
      where state = 'sent' and held_at <= $2
      returning ${LETTER_COLUMNS}`,
    [now, cutoff],
  );
  return result.rows;
}

export async function retractLetter(db: Db, letterId: string, now: Date): Promise<LetterRow> {
  const result = await db.query<LetterRow>(
    `update letters set retracted_at = $2, iv = null, ciphertext = null
      where id = $1 returning ${LETTER_COLUMNS}`,
    [letterId, now],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('retract returned no row');
  return row;
}
