import { randomUUID } from 'node:crypto';
import { base64urlEncode } from '../../shared/scheme.js';
import type {
  ConversationRecord,
  ConversationStatus,
  PeerRecord,
  SealedProfile,
  SealStatus,
} from '../../shared/types.js';
import { serverNow } from '../clock.js';
import type { Db } from '../db.js';
import {
  loadConversation,
  peerOf,
  type ConversationAccess,
  type ConversationRow,
  type SideRow,
} from './access.js';
import { LETTER_COLUMNS, letterRecord, type LetterRow } from './letters.js';
import { unreadCount } from './unread.js';

export interface AccountRow {
  id: string;
  username: string;
  read_receipts: boolean;
  preview: string;
  profile_iv: string | null;
  profile_ciphertext: string | null;
  profile_photo_blob_id: string | null;
  username_changed_at: Date | null;
  created_at: Date;
}

export interface KeyRow {
  account_id: string;
  key_id: string;
  public_key: Buffer;
  created_at: Date;
  is_current: boolean;
}

export function sealedProfile(account: AccountRow): SealedProfile | null {
  if (account.profile_iv === null || account.profile_ciphertext === null) return null;
  return {
    iv: account.profile_iv,
    ciphertext: account.profile_ciphertext,
    photo_blob_id: account.profile_photo_blob_id,
  };
}

export async function currentKey(db: Db, accountId: string): Promise<KeyRow> {
  const result = await db.query<KeyRow>(
    'select * from account_keys where account_id = $1 and is_current',
    [accountId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('account without a current key');
  return row;
}

export async function accountRow(db: Db, accountId: string): Promise<AccountRow> {
  const result = await db.query<AccountRow>('select * from accounts where id = $1', [accountId]);
  const row = result.rows[0];
  if (row === undefined) throw new Error('unknown account');
  return row;
}

/** The seal a viewer has accepted for a contact, and whether the contact's key moved on. */
export async function sealStatus(
  db: Db,
  viewerId: string,
  contactId: string,
  contactKeyId: string,
): Promise<SealStatus> {
  const result = await db.query<{ accepted_key_id: string; verified: boolean }>(
    'select accepted_key_id, verified from seals where viewer_id = $1 and contact_id = $2',
    [viewerId, contactId],
  );
  const seal = result.rows[0];
  if (seal === undefined || seal.accepted_key_id !== contactKeyId) return 'changed';
  return seal.verified ? 'verified' : 'unverified';
}

export async function recordSeal(db: Db, viewerId: string, contactId: string): Promise<void> {
  const key = await currentKey(db, contactId);
  await db.query(
    `insert into seals (viewer_id, contact_id, accepted_key_id, verified)
     values ($1, $2, $3, false) on conflict do nothing`,
    [viewerId, contactId, key.key_id],
  );
}

export async function isBlocked(db: Db, blockerId: string, blockedId: string): Promise<boolean> {
  const result = await db.query('select 1 from blocks where blocker_id = $1 and blocked_id = $2', [
    blockerId,
    blockedId,
  ]);
  return result.rows.length > 0;
}

function muteValue(side: SideRow, now: Date): string | 'always' | null {
  if (side.muted_always) return 'always';
  if (side.muted_until !== null && side.muted_until.getTime() > now.getTime()) {
    return side.muted_until.toISOString();
  }
  return null;
}

async function lastLetter(
  db: Db,
  conversationId: string,
  viewerId: string,
  hideSeq: string,
): Promise<LetterRow | null> {
  const result = await db.query<LetterRow>(
    `select ${LETTER_COLUMNS} from letters
      where conversation_id = $1 and letter_class = 'letter' and seq > $3
        and not (dropped and recipient_id = $2)
      order by seq desc limit 1`,
    [conversationId, viewerId, hideSeq],
  );
  return result.rows[0] ?? null;
}

export async function peerRecord(
  db: Db,
  viewerId: string,
  peerId: string,
  bothAccepted: boolean,
): Promise<PeerRecord> {
  const peer = await accountRow(db, peerId);
  const key = await currentKey(db, peerId);
  return {
    id: peer.id,
    username: peer.username,
    key_id: key.key_id,
    public_key: base64urlEncode(key.public_key),
    seal: await sealStatus(db, viewerId, peerId, key.key_id),
    profile: bothAccepted ? sealedProfile(peer) : null,
  };
}

export async function conversationRecord(
  db: Db,
  access: ConversationAccess,
  viewerId: string,
  now: Date,
): Promise<ConversationRecord> {
  const { conversation, side, peerSide, peerId } = access;
  const bothAccepted = side.accepted && peerSide.accepted;
  const letter = await lastLetter(db, conversation.id, viewerId, side.hide_seq);
  return {
    id: conversation.id,
    status: side.accepted ? 'accepted' : 'request',
    peer: await peerRecord(db, viewerId, peerId, bothAccepted),
    unread: await unreadCount(db, conversation.id, viewerId),
    muted_until: muteValue(side, now),
    blocked: await isBlocked(db, viewerId, peerId),
    last_letter: letter === null ? null : letterRecord(letter, viewerId, now),
    updated_at: conversation.updated_at.toISOString(),
  };
}

export async function conversationRecordById(
  db: Db,
  conversationId: string,
  viewerId: string,
  now: Date,
): Promise<ConversationRecord> {
  const access = await loadConversation(db, conversationId, viewerId);
  return conversationRecord(db, access, viewerId, now);
}

export async function listConversations(
  db: Db,
  viewerId: string,
  status: ConversationStatus,
): Promise<ConversationRecord[]> {
  const now = serverNow();
  const rows = await db.query<ConversationRow>(
    `select c.* from conversations c
       join conversation_sides s on s.conversation_id = c.id
      where s.account_id = $1 and s.visible and s.accepted = $2
      order by c.updated_at desc`,
    [viewerId, status === 'accepted'],
  );
  const records: ConversationRecord[] = [];
  for (const row of rows.rows) {
    const access = await loadConversation(db, row.id, viewerId);
    records.push(await conversationRecord(db, access, viewerId, now));
  }
  return records;
}

/** Finds the pair's conversation, or starts one with the caller as its starter. */
export async function findOrCreateConversation(
  db: Db,
  starterId: string,
  peerId: string,
  now: Date,
): Promise<{ id: string; created: boolean }> {
  const [a, b] = [starterId, peerId].sort();
  const existing = await db.query<{ id: string }>(
    'select id from conversations where peer_a = $1 and peer_b = $2',
    [a, b],
  );
  const found = existing.rows[0];
  if (found !== undefined) return { id: found.id, created: false };

  const id = randomUUID();
  const inserted = await db.query<{ id: string }>(
    `insert into conversations (id, peer_a, peer_b, starter_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $5)
     on conflict (peer_a, peer_b) do nothing
     returning id`,
    [id, a, b, starterId, now],
  );
  if (inserted.rows.length === 0) {
    const raced = await db.query<{ id: string }>(
      'select id from conversations where peer_a = $1 and peer_b = $2',
      [a, b],
    );
    const row = raced.rows[0];
    if (row === undefined) throw new Error('conversation vanished');
    return { id: row.id, created: false };
  }
  await db.query(
    `insert into conversation_sides (conversation_id, account_id, accepted, visible)
     values ($1, $2, true, true), ($1, $3, false, false)`,
    [id, starterId, peerId],
  );
  await recordSeal(db, starterId, peerId);
  await recordSeal(db, peerId, starterId);
  return { id, created: true };
}

export function participants(conversation: ConversationRow): [string, string] {
  return [conversation.peer_a, conversation.peer_b];
}

export { peerOf };
