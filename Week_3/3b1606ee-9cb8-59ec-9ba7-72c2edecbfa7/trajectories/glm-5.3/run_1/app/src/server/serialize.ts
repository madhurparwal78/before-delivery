import type { Account, BlobRecord, Conversation, Letter, LetterState, SealedProfile } from '../shared/types.js';
import type { AccountRecord } from './accounts.js';
import type { ConversationRecord, LetterRecord, SideRecord } from './conversations.js';
import { now } from './clock.js';
import { REJECT_WINDOW_HOURS } from '../shared/sealing-spec.js';

export function iso(value: Date): string {
  return value.toISOString();
}

export function serializeAccount(account: AccountRecord): Account {
  const profile: SealedProfile | null = account.profile_iv !== null && account.profile_ciphertext !== null
    ? { iv: account.profile_iv, ciphertext: account.profile_ciphertext, photo_blob_id: account.profile_photo_blob_id }
    : null;
  return {
    id: account.id,
    username: account.username,
    key_id: account.key_id,
    public_key: account.public_key,
    settings: { read_receipts: account.read_receipts, preview: account.preview },
    profile,
    username_changed_at: account.username_changed_at ? iso(account.username_changed_at) : null,
    created_at: iso(account.created_at),
  };
}

/** The retract window, decided here and nowhere else: sender only, before held_at plus 24 hours. */
export function retractWindowOpen(row: LetterRecord, viewerId: string): boolean {
  if (row.sender_id !== viewerId) return false;
  if (row.retracted_at !== null) return false;
  return now().getTime() < row.held_at.getTime() + REJECT_WINDOW_HOURS * 3600 * 1000;
}

/** A letter as one participant sees it: ciphertext only while held for the recipient and not retracted. */
export function serializeLetter(row: LetterRecord, viewerId: string): Letter {
  const isRecipient = row.recipient_id === viewerId;
  const showSealed = isRecipient && row.state === 'sent' && row.retracted_at === null;
  const state: LetterState = row.state;
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    seq: Number(row.seq),
    sender_id: row.sender_id,
    recipient_id: row.recipient_id,
    class: row.class,
    state,
    failure: row.failure,
    held_at: iso(row.held_at),
    delivered_at: row.delivered_at ? iso(row.delivered_at) : null,
    read_at: row.read_at ? iso(row.read_at) : null,
    returned_at: row.returned_at ? iso(row.returned_at) : null,
    retracted_at: row.retracted_at ? iso(row.retracted_at) : null,
    can_retract: retractWindowOpen(row, viewerId),
    sender_key_id: row.sender_key_id,
    recipient_key_id: row.recipient_key_id,
    iv: showSealed ? row.iv : null,
    ciphertext: showSealed ? row.ciphertext : null,
    attachment_id: row.attachment_id,
  };
}

export function serializeConversation(input: {
  conversation: ConversationRecord;
  side: SideRecord;
  peer: { id: string; username: string; key_id: string; public_key: string; seal: 'verified' | 'unverified' | 'changed'; profile: SealedProfile | null };
  unread: number;
  lastLetter: LetterRecord | null;
  viewerId: string;
  blocked: boolean;
}): Conversation {
  return {
    id: input.conversation.id,
    status: input.side.status,
    peer: input.peer,
    unread: input.unread,
    muted_until: input.side.mute_always ? 'always' : input.side.muted_until ? iso(input.side.muted_until) : null,
    blocked: input.blocked,
    last_letter: input.lastLetter ? serializeLetter(input.lastLetter, input.viewerId) : null,
    updated_at: iso(input.conversation.updated_at),
  };
}

export function serializeBlob(row: { id: string; kind: BlobRecord['kind']; size: number; state: BlobRecord['state'] }): BlobRecord {
  return { id: row.id, kind: row.kind, size: Number(row.size), state: row.state };
}
