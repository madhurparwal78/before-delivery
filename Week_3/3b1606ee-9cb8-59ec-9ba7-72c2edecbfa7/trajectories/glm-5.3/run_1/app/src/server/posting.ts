import { now } from './clock.js';
import { query, txQuery, withTransaction } from './db.js';
import { newId, nextSeq } from './store.js';
import {
  sealStatusOf,
  currentKeyOf,
  type ConversationRecord,
  type LetterRecord,
  type SideRecord,
} from './conversations.js';

// The posting rules: one letter per client letter id, and the 409 ladder, decided here. DP-09, DP-32.

export type PostConflict =
  | 'request_not_accepted'
  | 'contact_blocked'
  | 'seal_change_unaccepted'
  | 'recipient_key_changed'
  | 'attachment_not_stored'
  | 'attachment_in_use';

export class LetterConflictError extends Error {
  constructor(public code: PostConflict | 'letter_id_conflict', public keyId?: string) {
    super(code);
  }
}

export interface PostInput {
  id: string;
  conversation: ConversationRecord;
  class: 'letter' | 'control';
  recipient_key_id: string;
  iv: string | null;
  ciphertext: string | null;
  attachment_id: string | null;
}

/** A stored letter that answers a replay of the same client letter id. */
export function samePost(existing: LetterRecord, input: PostInput): boolean {
  return (
    existing.conversation_id === input.conversation.id &&
    existing.class === input.class &&
    existing.recipient_key_id === input.recipient_key_id &&
    existing.iv === input.iv &&
    existing.ciphertext === input.ciphertext &&
    (existing.attachment_id ?? null) === input.attachment_id
  );
}

export interface PostOutcome {
  letter: LetterRecord;
  created: boolean;
}

export async function postLetter(senderId: string, input: PostInput, recipientId: string, senderBlockedRecipient: boolean, recipientBlockedSender: boolean, attachmentState: 'none' | 'stored' | 'not_stored' | 'in_use'): Promise<PostOutcome> {
  return withTransaction(async (client) => {
    const senderSide = (await txQuery<SideRecord>(client, 'SELECT * FROM conversation_sides WHERE conversation_id = $1 AND account_id = $2 FOR UPDATE', [input.conversation.id, senderId]))[0];
    if (!senderSide) throw new LetterConflictError('letter_id_conflict');

    // 409 ladder, first match wins.
    if (senderSide.status === 'request') throw new LetterConflictError('request_not_accepted');
    if (senderBlockedRecipient) throw new LetterConflictError('contact_blocked');

    const senderKey = await currentKeyOf(senderId);
    if (!senderKey) throw new LetterConflictError('letter_id_conflict');

    const peerCurrent = await currentKeyOf(recipientId);
    if (!peerCurrent) throw new LetterConflictError('letter_id_conflict');

    if (input.recipient_key_id !== peerCurrent.key_id) {
      throw new LetterConflictError('recipient_key_changed', peerCurrent.key_id);
    }

    // The sender's accepted key for the peer, compared with the peer's current key.
    const seal = sealStatusOf(peerCurrent.key_id, senderSide.accepted_key_id, senderSide.seal_verified);
    if (input.class === 'letter' && seal === 'changed') throw new LetterConflictError('seal_change_unaccepted');

    if (input.attachment_id !== null) {
      if (attachmentState === 'not_stored') throw new LetterConflictError('attachment_not_stored');
      if (attachmentState === 'in_use') throw new LetterConflictError('attachment_in_use');
    }

    const seq = await nextSeq(client);
    const heldAt = now();
    const storeBytes = !recipientBlockedSender;
    const rows = await txQuery<LetterRecord>(client, `
      INSERT INTO letters (id, conversation_id, seq, sender_id, recipient_id, class, state, held_at, sender_key_id, recipient_key_id, iv, ciphertext, attachment_id, blocked_post)
      VALUES ($1,$2,$3,$4,$5,$6,'sent',$7,$8,$9,$10,$11,$12,$13)
      RETURNING *`,
      [input.id, input.conversation.id, seq, senderId, recipientId, input.class, heldAt, senderKey.key_id, input.recipient_key_id, storeBytes ? input.iv : null, storeBytes ? input.ciphertext : null, input.attachment_id, recipientBlockedSender]);
    await txQuery(client, 'UPDATE conversations SET updated_at = $2 WHERE id = $1', [input.conversation.id, heldAt]);
    return { letter: rows[0], created: true };
  });
}
