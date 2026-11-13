import type { PoolClient } from 'pg';
import { now } from './clock.js';
import { query, txQuery, withTransaction } from './db.js';
import { newId } from './store.js';
import { RETURN_DAYS } from '../shared/sealing-spec.js';

// Letter delivery states, decided here and nowhere else. DP-10, DP-15.

export interface ConversationRecord {
  id: string;
  starter_id: string;
  recipient_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface SideRecord {
  conversation_id: string;
  account_id: string;
  status: 'accepted' | 'request';
  read_through_seq: number;
  muted_until: Date | null;
  mute_always: boolean;
  accepted_key_id: string | null;
  seal_verified: boolean;
  deleted_at: Date | null;
}

export interface LetterRecord {
  id: string;
  conversation_id: string;
  seq: number;
  sender_id: string;
  recipient_id: string;
  class: 'letter' | 'control';
  state: 'sent' | 'delivered' | 'read' | 'failed';
  failure: null | 'returned';
  held_at: Date;
  delivered_at: Date | null;
  read_at: Date | null;
  returned_at: Date | null;
  retracted_at: Date | null;
  sender_key_id: string;
  recipient_key_id: string;
  iv: string | null;
  ciphertext: string | null;
  attachment_id: string | null;
  blocked_post: boolean;
}

export async function conversationById(id: string): Promise<ConversationRecord | null> {
  const rows = await query<ConversationRecord>('SELECT * FROM conversations WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function sidesOf(conversationId: string): Promise<SideRecord[]> {
  return query<SideRecord>('SELECT * FROM conversation_sides WHERE conversation_id = $1', [conversationId]);
}

export async function sideOf(conversationId: string, accountId: string): Promise<SideRecord | null> {
  const rows = await query<SideRecord>('SELECT * FROM conversation_sides WHERE conversation_id = $1 AND account_id = $2', [conversationId, accountId]);
  return rows[0] ?? null;
}

export async function findOrCreateConversation(starterId: string, peerId: string): Promise<{ conversation: ConversationRecord; created: boolean }> {
  return withTransaction(async (client) => {
    const existing = await txQuery<ConversationRecord>(client, `
      SELECT * FROM conversations WHERE (starter_id = $1 AND recipient_id = $2) OR (starter_id = $2 AND recipient_id = $1) FOR UPDATE`,
      [starterId, peerId]);
    if (existing.length > 0) return { conversation: existing[0], created: false };
    const id = newId();
    const at = now();
    await txQuery(client, 'INSERT INTO conversations (id, starter_id, recipient_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$4)',
      [id, starterId, peerId, at]);
    const starterKey = await currentKeyId(client, peerId);
    const recipientKey = await currentKeyId(client, starterId);
    await txQuery(client, `INSERT INTO conversation_sides (conversation_id, account_id, status, accepted_key_id) VALUES ($1,$2,'accepted',$3),($1,$4,'request',$5)`,
      [id, starterId, starterKey, peerId, recipientKey]);
    return { conversation: { id, starter_id: starterId, recipient_id: peerId, created_at: at, updated_at: at }, created: true };
  });
}

async function currentKeyId(client: PoolClient, accountId: string): Promise<string> {
  const rows = await txQuery<{ key_id: string }>(client, 'SELECT key_id FROM account_keys WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1', [accountId]);
  return rows[0].key_id;
}

export async function currentKeyOf(accountId: string): Promise<{ key_id: string; public_key: string } | null> {
  const rows = await query<{ key_id: string; public_key: string }>(
    'SELECT key_id, public_key FROM account_keys WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1', [accountId]);
  return rows[0] ?? null;
}

export async function keyById(accountId: string, keyId: string): Promise<{ key_id: string; public_key: string } | null> {
  const rows = await query<{ key_id: string; public_key: string }>('SELECT key_id, public_key FROM account_keys WHERE account_id = $1 AND key_id = $2', [accountId, keyId]);
  return rows[0] ?? null;
}

/** Seal status: changed whenever the peer's current key differs from the accepted one. DP-30, DP-32. */
export function sealStatusOf(peerCurrentKeyId: string, acceptedKeyId: string | null, verified: boolean): 'verified' | 'unverified' | 'changed' {
  if (acceptedKeyId !== peerCurrentKeyId) return 'changed';
  return verified ? 'verified' : 'unverified';
}

export async function unreadCount(conversationId: string, viewerId: string): Promise<number> {
  const rows = await query<{ count: string }>(`
    SELECT COUNT(*) AS count FROM letters l
    JOIN conversation_sides s ON s.conversation_id = l.conversation_id AND s.account_id = $2
    WHERE l.conversation_id = $1
      AND l.recipient_id = $2
      AND l.class = 'letter'
      AND l.state IN ('delivered','read')
      AND l.retracted_at IS NULL
      AND l.seq > s.read_through_seq`, [conversationId, viewerId]);
  return Number(rows[0].count);
}

export async function markRead(client: PoolClient, conversationId: string, viewerId: string, throughSeq: number): Promise<LetterRecord[]> {
  const nowDate = now();
  const sides = await txQuery<SideRecord>(client, 'SELECT * FROM conversation_sides WHERE conversation_id = $1 AND account_id = $2 FOR UPDATE', [conversationId, viewerId]);
  const side = sides[0];
  if (!side || throughSeq <= side.read_through_seq) return [];
  await txQuery(client, 'UPDATE conversation_sides SET read_through_seq = $3 WHERE conversation_id = $1 AND account_id = $2', [conversationId, viewerId, throughSeq]);
  // Read receipts are reciprocal: both sides must have them on and the conversation accepted. DP-11.
  const readRows = await txQuery<LetterRecord>(client, `
    UPDATE letters l SET state = 'read', read_at = $4
    WHERE l.conversation_id = $1 AND l.recipient_id = $2 AND l.state = 'delivered' AND l.seq <= $3
      AND l.retracted_at IS NULL
      AND EXISTS (SELECT 1 FROM conversation_sides ms WHERE ms.conversation_id = l.conversation_id AND ms.account_id = l.recipient_id AND ms.status = 'accepted')
      AND EXISTS (SELECT 1 FROM accounts rs WHERE rs.id = l.sender_id AND rs.read_receipts = TRUE)
      AND EXISTS (SELECT 1 FROM accounts rr WHERE rr.id = l.recipient_id AND rr.read_receipts = TRUE)
    RETURNING *`, [conversationId, viewerId, throughSeq, nowDate]);
  return readRows;
}

export async function acceptConversation(conversationId: string, viewerId: string): Promise<void> {
  await withTransaction(async (client) => {
    await txQuery(client, `UPDATE conversation_sides SET status = 'accepted' WHERE conversation_id = $1 AND account_id = $2`, [conversationId, viewerId]);
    await txQuery(client, `UPDATE conversations SET updated_at = $2 WHERE id = $1`, [conversationId, now()]);
  });
}

export async function deleteRequestFor(conversationId: string, viewerId: string): Promise<void> {
  await query(`UPDATE conversation_sides SET deleted_at = $3 WHERE conversation_id = $1 AND account_id = $2`, [conversationId, viewerId, now()]);
}

export async function setMute(conversationId: string, viewerId: string, duration: '1h' | '8h' | '1w' | 'always' | 'off'): Promise<void> {
  await withTransaction(async (client) => {
    if (duration === 'off') {
      await txQuery(client, 'UPDATE conversation_sides SET muted_until = NULL, mute_always = FALSE WHERE conversation_id = $1 AND account_id = $2', [conversationId, viewerId]);
    } else if (duration === 'always') {
      await txQuery(client, 'UPDATE conversation_sides SET muted_until = NULL, mute_always = TRUE WHERE conversation_id = $1 AND account_id = $2', [conversationId, viewerId]);
    } else {
      const ms = duration === '1h' ? 3600_000 : duration === '8h' ? 8 * 3600_000 : 7 * 24 * 3600_000;
      await txQuery(client, 'UPDATE conversation_sides SET muted_until = $3, mute_always = FALSE WHERE conversation_id = $1 AND account_id = $2',
        [conversationId, viewerId, new Date(now().getTime() + ms)]);
    }
  });
}

export interface PostLetterInput {
  id: string;
  conversation_id: string;
  class: 'letter' | 'control';
  recipient_key_id: string;
  iv: string | null;
  ciphertext: string | null;
  attachment_id: string | null;
  sender_id: string;
  recipient_id: string;
}

export async function letterById(id: string): Promise<LetterRecord | null> {
  // Returns are applied on every read of the affected rows. DP-10, DP-15.
  await applyReturns();
  const rows = await query<LetterRecord>('SELECT * FROM letters WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function lettersOfConversation(conversationId: string, beforeSeq: number | null, limit: number): Promise<LetterRecord[]> {
  await applyReturns();
  if (beforeSeq === null) {
    return query<LetterRecord>('SELECT * FROM letters WHERE conversation_id = $1 ORDER BY seq DESC LIMIT $2', [conversationId, limit]);
  }
  return query<LetterRecord>('SELECT * FROM letters WHERE conversation_id = $1 AND seq < $2 ORDER BY seq DESC LIMIT $3', [conversationId, beforeSeq, limit]);
}

export async function lastLetterForSides(conversationId: string, viewerId: string): Promise<LetterRecord | null> {
  const rows = await query<LetterRecord>(`
    SELECT * FROM letters WHERE conversation_id = $1
      AND (sender_id = $2 OR (recipient_id = $2 AND retracted_at IS NULL AND NOT (recipient_id = $2 AND state = 'failed')))
      ORDER BY seq DESC LIMIT 1`, [conversationId, viewerId]);
  return rows[0] ?? null;
}

/** The inbox: every letter held for the caller, ascending seq. DP-15. */
export async function inboxFor(accountId: string): Promise<LetterRecord[]> {
  await applyReturns();
  // Letters from senders the viewer has blocked are never queued for them.
  return query<LetterRecord>(`
    SELECT l.* FROM letters l
    WHERE l.recipient_id = $1 AND l.state = 'sent' AND l.retracted_at IS NULL AND l.blocked_post = FALSE
    ORDER BY l.seq ASC`, [accountId]);
}

/** Returns uncollected letters past 30 days, deleting ciphertext and attachments. Applied on read and by a sweep. */
export async function applyReturns(): Promise<LetterRecord[]> {
  const cutoff = new Date(now().getTime() - RETURN_DAYS * 24 * 3600 * 1000);
  return withTransaction(async (client) => {
    const rows = await txQuery<LetterRecord>(client, `
      UPDATE letters SET state = 'failed', failure = 'returned', returned_at = $2, iv = NULL, ciphertext = NULL
      WHERE state = 'sent' AND held_at < $1
      RETURNING *`, [cutoff, now()]);
    return rows;
  });
}

export async function ackInbox(accountId: string, throughSeq: number): Promise<number> {
  return withTransaction(async (client) => {
    const rows = await txQuery<LetterRecord>(client, `
      UPDATE letters SET state = 'delivered', delivered_at = $2, iv = NULL, ciphertext = NULL
      WHERE recipient_id = $1 AND state = 'sent' AND seq <= $3 AND retracted_at IS NULL
      RETURNING *`, [accountId, now(), throughSeq]);
    return rows.length;
  });
}

export async function touchConversation(conversationId: string): Promise<void> {
  await query('UPDATE conversations SET updated_at = $2 WHERE id = $1', [conversationId, now()]);
}

export async function retractLetter(letter: LetterRecord): Promise<void> {
  await withTransaction(async (client) => {
    await txQuery(client, 'UPDATE letters SET retracted_at = $2, iv = NULL, ciphertext = NULL WHERE id = $1', [letter.id, now()]);
  });
}

export async function canRetract(letter: LetterRecord, viewerId: string): Promise<boolean> {
  if (letter.sender_id !== viewerId) return false;
  if (letter.retracted_at !== null) return false;
  return now().getTime() < letter.held_at.getTime() + 24 * 3600 * 1000;
}

export async function conversationsForSides(viewerId: string, statuses: Array<'accepted' | 'request'>): Promise<Array<{ conversation: ConversationRecord; side: SideRecord; peerId: string }>> {
  const rows = await query<ConversationRecord & SideRecord & { peer_id: string }>(`
    SELECT c.*, s.*, CASE WHEN c.starter_id = $1 THEN c.recipient_id ELSE c.starter_id END AS peer_id
    FROM conversations c
    JOIN conversation_sides s ON s.conversation_id = c.id AND s.account_id = $1
    WHERE s.status = ANY($2::text[]) AND s.deleted_at IS NULL
    ORDER BY c.updated_at DESC`, [viewerId, statuses]);
  return rows.map((r) => ({
    conversation: { id: r.id, starter_id: r.starter_id, recipient_id: r.recipient_id, created_at: r.created_at, updated_at: r.updated_at },
    side: { conversation_id: r.conversation_id, account_id: r.account_id, status: r.status, read_through_seq: Number(r.read_through_seq), muted_until: r.muted_until, mute_always: r.mute_always, accepted_key_id: r.accepted_key_id, seal_verified: r.seal_verified, deleted_at: r.deleted_at },
    peerId: r.peer_id,
  }));
}

export async function isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
  const rows = await query<{ count: string }>('SELECT COUNT(*) AS count FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [blockerId, blockedId]);
  return Number(rows[0].count) > 0;
}

export async function blockAccount(blockerId: string, blockedId: string): Promise<Date> {
  const at = now();
  await query(`INSERT INTO blocks (blocker_id, blocked_id, blocked_at) VALUES ($1,$2,$3)
    ON CONFLICT (blocker_id, blocked_id) DO UPDATE SET blocked_at = EXCLUDED.blocked_at`, [blockerId, blockedId, at]);
  return at;
}

export async function unblockAccount(blockerId: string, blockedId: string): Promise<void> {
  await query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [blockerId, blockedId]);
}

export async function blocksOf(viewerId: string): Promise<Array<{ account_id: string; username: string; blocked_at: Date }>> {
  return query(`SELECT b.blocked_id AS account_id, a.username, b.blocked_at FROM blocks b JOIN accounts a ON a.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY b.blocked_at DESC`, [viewerId]);
}

export async function setSeal(viewerId: string, peerId: string, keyId: string, verified: boolean): Promise<void> {
  await withTransaction(async (client) => {
    const rows = await txQuery<{ conversation_id: string }>(client, `
      SELECT c.id AS conversation_id FROM conversations c
      WHERE (c.starter_id = $1 AND c.recipient_id = $2) OR (c.starter_id = $2 AND c.recipient_id = $1)`, [viewerId, peerId]);
    for (const row of rows) {
      await txQuery(client, 'UPDATE conversation_sides SET accepted_key_id = $3, seal_verified = $2 WHERE conversation_id = $1 AND account_id = $4',
        [row.conversation_id, verified, keyId, viewerId]);
    }
  });
}
