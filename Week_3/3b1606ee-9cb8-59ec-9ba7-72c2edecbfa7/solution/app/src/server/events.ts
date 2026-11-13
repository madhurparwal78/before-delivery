import type { ServerFrame } from '../shared/types.js';
import { discardBlobs } from './blobs.js';
import { now } from './clock.js';
import { conversationRecord } from './conversation_view.js';
import { pool, query } from './db.js';
import { returnExpired } from './delivery.js';
import { push } from './hub.js';
import { letterRecord } from './records.js';
import type { LetterRow } from './rows.js';

/** A letter posted to someone who blocked the sender: held for nobody, so only its sender hears of it. */
const droppedForRecipient = (row: LetterRow): boolean => row.state === 'sent' && row.ciphertext === null && row.retracted_at === null;

/** Every new or changed letter goes to both participants, each as that person sees it. */
export async function announceLetters(rows: LetterRow[]): Promise<void> {
  try {
    await pushLetters(rows);
  } catch {
    // Pushes are best effort: the change is stored, and a browser catches up on its next load or reconnect.
  }
}

async function pushLetters(rows: LetterRow[]): Promise<void> {
  const at = now();
  const audience = new Map<string, Set<string>>();
  for (const row of rows) {
    const viewers = droppedForRecipient(row) ? [row.sender_id] : [row.sender_id, row.recipient_id];
    for (const viewerId of viewers) {
      push(viewerId, { type: 'letter', letter: letterRecord(row, viewerId, at) } satisfies ServerFrame);
      if (row.class === 'letter') audience.set(row.conversation_id, (audience.get(row.conversation_id) ?? new Set<string>()).add(viewerId));
    }
  }
  for (const [conversationId, viewers] of audience) await pushConversations([conversationId], [...viewers]);
}

/** Sends each member's own view of a conversation; `only` limits it to some members. */
export async function announceConversations(conversationIds: string[], only?: string[]): Promise<void> {
  try {
    await pushConversations(conversationIds, only);
  } catch {
    // best effort, as above
  }
}

async function pushConversations(conversationIds: string[], only?: string[]): Promise<void> {
  for (const conversationId of conversationIds) {
    const members = await query<{ account_id: string }>(pool, 'SELECT account_id FROM conversation_members WHERE conversation_id = $1', [conversationId]);
    for (const { account_id: accountId } of members) {
      if (only && !only.includes(accountId)) continue;
      const conversation = await conversationRecord(pool, accountId, conversationId);
      if (conversation) push(accountId, { type: 'conversation', conversation });
    }
  }
}

/** The conversations an account shares with others, so those others see its new name, profile or key. */
export async function announceToContacts(accountId: string, withKeys: boolean): Promise<void> {
  try {
    await pushToContacts(accountId, withKeys);
  } catch {
    // best effort, as above
  }
}

async function pushToContacts(accountId: string, withKeys: boolean): Promise<void> {
  const shared = await query<{ conversation_id: string; account_id: string }>(
    pool,
    `SELECT me.conversation_id, them.account_id FROM conversation_members me
     JOIN conversation_members them ON them.conversation_id = me.conversation_id AND them.account_id <> me.account_id
     WHERE me.account_id = $1`,
    [accountId],
  );
  for (const row of shared) {
    if (withKeys) push(row.account_id, { type: 'keys', account_id: accountId });
    const conversation = await conversationRecord(pool, row.account_id, row.conversation_id);
    if (conversation) push(row.account_id, { type: 'conversation', conversation });
  }
}

/** sent -> returned for letters held 30 days, and the deleting of their attachment objects. Pushes what changed. */
export async function applyReturns(): Promise<void> {
  const at = now();
  const returned = await returnExpired(pool, at);
  if (returned.length === 0) return;
  await discardBlobs(
    pool,
    returned.flatMap((row) => (row.attachment_id ? [row.attachment_id] : [])),
    at,
  );
  await announceLetters(returned);
}
