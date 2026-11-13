import { after, DAY, HOUR } from './clock.js';
import { query, type Queryable } from './db.js';
import type { LetterRow, MemberRow } from './rows.js';

/** A returned letter was not collected within this long of being held. */
const HOLD_MS = 30 * DAY;
const RETRACT_WINDOW_MS = 24 * HOUR;

/** The one place the retract window is decided. */
export function retractWindowOpen(heldAt: Date, at: Date): boolean {
  return at.getTime() < after(heldAt, RETRACT_WINDOW_MS).getTime();
}

interface HeldLetter {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  letterClass: 'letter' | 'control';
  senderKeyId: string;
  recipientKeyId: string;
  iv: Buffer | null;
  ciphertext: Buffer | null;
  attachmentId: string | null;
  contentDigest: Buffer;
}

/** (none) -> sent. A letter posted to someone who blocked the sender arrives without its sealed body and is never queued. */
export async function holdLetter(db: Queryable, letter: HeldLetter, at: Date): Promise<LetterRow> {
  const rows = await query<LetterRow>(
    db,
    `INSERT INTO letters (id, conversation_id, sender_id, recipient_id, class, state, held_at, sender_key_id,
                          recipient_key_id, iv, ciphertext, attachment_id, content_digest)
     VALUES ($1, $2, $3, $4, $5, 'sent', $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [
      letter.id,
      letter.conversationId,
      letter.senderId,
      letter.recipientId,
      letter.letterClass,
      at,
      letter.senderKeyId,
      letter.recipientKeyId,
      letter.iv,
      letter.ciphertext,
      letter.attachmentId,
      letter.contentDigest,
    ],
  );
  return rows[0]!;
}

/** sent -> delivered for every held letter up to `throughSeq`; the held copy is deleted in the same statement. */
export function deliverThrough(db: Queryable, recipientId: string, throughSeq: number, at: Date): Promise<LetterRow[]> {
  return query<LetterRow>(
    db,
    `UPDATE letters SET state = 'delivered', delivered_at = $3, iv = NULL, ciphertext = NULL
     WHERE recipient_id = $1 AND state = 'sent' AND ciphertext IS NOT NULL AND seq <= $2 RETURNING *`,
    [recipientId, throughSeq, at],
  );
}

/**
 * Moves the viewer's read marker forward, then delivered -> read for the letters this read newly covers, when the
 * conversation is accepted for the viewer and both people have read receipts on at this moment.
 */
export async function recordRead(db: Queryable, member: MemberRow, receiptsOn: boolean, throughSeq: number, at: Date): Promise<LetterRow[]> {
  const previous = member.read_through_seq;
  if (throughSeq > previous) {
    await query(db, 'UPDATE conversation_members SET read_through_seq = $3 WHERE conversation_id = $1 AND account_id = $2', [
      member.conversation_id,
      member.account_id,
      throughSeq,
    ]);
  }
  if (member.status !== 'accepted' || !receiptsOn || throughSeq <= previous) return [];
  return query<LetterRow>(
    db,
    `UPDATE letters l SET state = 'read', read_at = $5
     FROM accounts sender
     WHERE sender.id = l.sender_id AND sender.read_receipts
       AND l.conversation_id = $1 AND l.recipient_id = $2 AND l.class = 'letter' AND l.state = 'delivered'
       AND l.seq > $3 AND l.seq <= $4 AND l.seq >= $6
     RETURNING l.*`,
    [member.conversation_id, member.account_id, previous, throughSeq, at, member.visible_from_seq],
  );
}

/** sent -> failed (returned) for every letter still held 30 days after it was held. */
export function returnExpired(db: Queryable, at: Date): Promise<LetterRow[]> {
  return query<LetterRow>(
    db,
    `UPDATE letters SET state = 'failed', failure = 'returned', returned_at = $1, iv = NULL, ciphertext = NULL
     WHERE state = 'sent' AND retracted_at IS NULL AND held_at <= $2 RETURNING *`,
    [at, new Date(at.getTime() - HOLD_MS)],
  );
}
