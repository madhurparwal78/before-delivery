import type { Account, BlobRecord, Letter } from '../shared/types.js';
import { retractWindowOpen } from './delivery.js';
import type { AccountRow, BlobRow, LetterRow } from './rows.js';
import { encodeBase64url } from './validate.js';

export const iso = (date: Date): string => date.toISOString();
const isoOrNull = (date: Date | null): string | null => (date ? iso(date) : null);

export function accountRecord(row: AccountRow): Account {
  return {
    id: row.id,
    username: row.username,
    key_id: row.key_id,
    public_key: encodeBase64url(row.public_key),
    settings: { read_receipts: row.read_receipts, preview: row.preview },
    profile:
      row.profile_iv && row.profile_ciphertext
        ? {
            iv: encodeBase64url(row.profile_iv),
            ciphertext: encodeBase64url(row.profile_ciphertext),
            photo_blob_id: row.profile_photo_blob_id,
          }
        : null,
    username_changed_at: isoOrNull(row.username_changed_at),
    created_at: iso(row.created_at),
  };
}

/** A letter as `viewerId` sees it: the sealed body only reaches the recipient, and only while it is held. */
export function letterRecord(row: LetterRow, viewerId: string, at: Date): Letter {
  const heldForViewer = row.recipient_id === viewerId && row.iv !== null && row.ciphertext !== null;
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    seq: row.seq,
    sender_id: row.sender_id,
    recipient_id: row.recipient_id,
    class: row.class,
    state: row.state,
    failure: row.failure,
    held_at: iso(row.held_at),
    delivered_at: isoOrNull(row.delivered_at),
    read_at: isoOrNull(row.read_at),
    returned_at: isoOrNull(row.returned_at),
    retracted_at: isoOrNull(row.retracted_at),
    can_retract:
      row.sender_id === viewerId && row.class === 'letter' && row.retracted_at === null && retractWindowOpen(row.held_at, at),
    sender_key_id: row.sender_key_id,
    recipient_key_id: row.recipient_key_id,
    iv: heldForViewer && row.iv ? encodeBase64url(row.iv) : null,
    ciphertext: heldForViewer && row.ciphertext ? encodeBase64url(row.ciphertext) : null,
    attachment_id: row.attachment_id,
  };
}

export const blobRecord = (row: BlobRow): BlobRecord => ({ id: row.id, kind: row.kind, size: row.size, state: row.state });
