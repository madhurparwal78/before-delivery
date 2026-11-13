import { one, type Queryable } from './db.js';
import { notFound } from './http.js';
import type { AccountRow, BlobRow, ConversationRow, LetterRow, MemberRow } from './rows.js';
import { isUuid } from './validate.js';

export interface ConversationAccess {
  conversation: ConversationRow;
  member: MemberRow;
  peerMember: MemberRow;
  peer: AccountRow;
}

/**
 * The one place participant access is decided. Only the two participants may reach a conversation, and only while it
 * is visible to them (accepted, or a request they have been shown). Everyone else gets the 404 of an unknown id.
 */
export async function requireConversation(db: Queryable, accountId: string, conversationId: unknown): Promise<ConversationAccess> {
  if (!isUuid(conversationId)) throw notFound();
  const member = await one<MemberRow>(
    db,
    `SELECT * FROM conversation_members WHERE conversation_id = $1 AND account_id = $2 AND status IN ('accepted', 'request')`,
    [conversationId, accountId],
  );
  if (!member) throw notFound();
  const conversation = await one<ConversationRow>(db, 'SELECT * FROM conversations WHERE id = $1', [conversationId]);
  const peerMember = await one<MemberRow>(
    db,
    'SELECT * FROM conversation_members WHERE conversation_id = $1 AND account_id <> $2',
    [conversationId, accountId],
  );
  const peer = peerMember && (await one<AccountRow>(db, 'SELECT * FROM accounts WHERE id = $1', [peerMember.account_id]));
  if (!conversation || !peerMember || !peer) throw notFound();
  return { conversation, member, peerMember, peer };
}

/** The caller must share a visible conversation with `otherId`; otherwise it is the 404 of an unknown id. */
export async function requireSharedConversation(db: Queryable, accountId: string, otherId: unknown): Promise<MemberRow> {
  if (!isUuid(otherId)) throw notFound();
  const shared = await one<MemberRow>(
    db,
    `SELECT me.* FROM conversation_members me JOIN conversation_members them ON them.conversation_id = me.conversation_id
     WHERE me.account_id = $1 AND them.account_id = $2 AND me.status IN ('accepted', 'request')`,
    [accountId, otherId],
  );
  if (!shared) throw notFound();
  return shared;
}

export async function requireLetter(db: Queryable, accountId: string, letterId: unknown): Promise<LetterRow> {
  if (!isUuid(letterId)) throw notFound();
  const letter = await one<LetterRow>(db, 'SELECT * FROM letters WHERE id = $1 AND (sender_id = $2 OR recipient_id = $2)', [letterId, accountId]);
  if (!letter) throw notFound();
  return letter;
}

export async function requireAccount(db: Queryable, accountId: unknown): Promise<AccountRow> {
  if (!isUuid(accountId)) throw notFound();
  const account = await one<AccountRow>(db, 'SELECT * FROM accounts WHERE id = $1', [accountId]);
  if (!account) throw notFound();
  return account;
}

/** A sealed profile is shared only between two people whose shared conversation is accepted for both. */
export async function profileShared(db: Queryable, viewerId: string, ownerId: string): Promise<boolean> {
  const found = await one<{ found: number }>(
    db,
    `SELECT 1 AS found FROM conversation_members a
     JOIN conversation_members b ON b.conversation_id = a.conversation_id
     WHERE a.account_id = $1 AND b.account_id = $2 AND a.status = 'accepted' AND b.status = 'accepted'`,
    [viewerId, ownerId],
  );
  return found !== null;
}

/**
 * Image and file blobs belong to their owner until a letter carries them, then to that letter's two participants.
 * A profile photo belongs to its owner and to everyone who receives the owner's profile.
 */
export async function blobReadableBy(db: Queryable, viewerId: string, blob: BlobRow): Promise<boolean> {
  if (blob.owner_id === viewerId) return true;
  if (blob.kind === 'photo') return profileShared(db, viewerId, blob.owner_id);
  const carrier = await one<{ found: number }>(
    db,
    'SELECT 1 AS found FROM letters WHERE attachment_id = $1 AND (sender_id = $2 OR recipient_id = $2)',
    [blob.id, viewerId],
  );
  return carrier !== null;
}
