import { requireAccount, requireConversation, requireSharedConversation } from './access.js';
import { now, after, HOUR, DAY } from './clock.js';
import { applyReturns, announceConversations, announceLetters } from './events.js';
import { one, pool, query, transaction, type Queryable } from './db.js';
import { recordRead } from './delivery.js';
import { ApiError, authed, invalid } from './http.js';
import type { AccountRow, ConversationRow } from './rows.js';
import { conversationRecord, conversationsFor } from './conversation_view.js';
import { isUuid, jsonBody } from './validate.js';

function pairOrder(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

const MUTE_MS: Record<string, number> = { '1h': HOUR, '8h': 8 * HOUR, '1w': 7 * DAY };

async function bump(db: Queryable, conversationId: string, at: Date): Promise<void> {
  await query(db, 'UPDATE conversations SET updated_at = $2 WHERE id = $1', [conversationId, at]);
}

export function registerConversationRoutes(): void {
  authed('POST', '/api/conversations', async ({ account, body }) => {
    const { peer_id: peerId } = jsonBody(body);
    if (!isUuid(peerId)) throw invalid({ peer_id: 'invalid' });
    if (peerId === account.id) throw invalid({ peer_id: 'self' });
    const peer = await requireAccount(pool, peerId);
    const at = now();
    const [low, high] = pairOrder(account.id, peer.id);
    const made = await transaction(async (db) => {
      const inserted = await query<ConversationRow>(
        db,
        `INSERT INTO conversations (id, starter_id, member_low, member_high, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $4) ON CONFLICT (member_low, member_high) DO NOTHING RETURNING *`,
        [account.id, low, high, at],
      );
      const fresh = inserted[0];
      if (fresh) {
        await query(db, `INSERT INTO conversation_members (conversation_id, account_id, status) VALUES ($1, $2, 'accepted'), ($1, $3, 'unseen')`, [
          fresh.id,
          account.id,
          peer.id,
        ]);
        await query(
          db,
          `INSERT INTO seals (viewer_id, contact_id, accepted_key_id, verified) VALUES ($1, $2, $3, false), ($2, $1, $4, false)
           ON CONFLICT DO NOTHING`,
          [account.id, peer.id, peer.key_id, account.key_id],
        );
        return { id: fresh.id, created: true };
      }
      const existing = (await one<ConversationRow>(db, 'SELECT * FROM conversations WHERE member_low = $1 AND member_high = $2', [low, high]))!;
      await query(
        db,
        `UPDATE conversation_members SET status = 'accepted' WHERE conversation_id = $1 AND account_id = $2 AND status IN ('unseen', 'deleted')`,
        [existing.id, account.id],
      );
      return { id: existing.id, created: false };
    });
    return { status: made.created ? 201 : 200, body: (await conversationRecord(pool, account.id, made.id))! };
  });

  authed('GET', '/api/conversations', async ({ account, query: params }) => {
    const wanted = params.get('status') ?? 'accepted';
    if (wanted !== 'accepted' && wanted !== 'request') throw invalid({ status: 'invalid' });
    await applyReturns();
    return { status: 200, body: { conversations: await conversationsFor(pool, account.id, wanted) } };
  });

  authed('GET', '/api/conversations/:id', async ({ account, params }) => {
    await requireConversation(pool, account.id, params.id);
    await applyReturns();
    return { status: 200, body: (await conversationRecord(pool, account.id, params.id!))! };
  });

  authed('POST', '/api/conversations/:id/accept', async ({ account, params }) => {
    const { member, conversation } = await requireConversation(pool, account.id, params.id);
    if (member.status !== 'request') throw new ApiError(409, 'not_a_request');
    await query(pool, `UPDATE conversation_members SET status = 'accepted' WHERE conversation_id = $1 AND account_id = $2`, [conversation.id, account.id]);
    await bump(pool, conversation.id, now());
    await announceConversations([conversation.id]);
    return { status: 200, body: (await conversationRecord(pool, account.id, conversation.id))! };
  });

  authed('DELETE', '/api/conversations/:id', async ({ account, params }) => {
    const { member, conversation } = await requireConversation(pool, account.id, params.id);
    if (member.status !== 'request') throw new ApiError(409, 'not_a_request');
    await query(pool, `UPDATE conversation_members SET status = 'deleted' WHERE conversation_id = $1 AND account_id = $2`, [conversation.id, account.id]);
    return { status: 204 };
  });

  authed('POST', '/api/conversations/:id/read', async ({ account, params, body }) => {
    const { member, conversation } = await requireConversation(pool, account.id, params.id);
    const { through_seq: through } = jsonBody(body);
    if (typeof through !== 'number' || !Number.isSafeInteger(through) || through < 0) throw invalid({ through_seq: 'invalid' });
    await applyReturns();
    const changed = await recordRead(pool, member, account.read_receipts, through, now());
    await announceLetters(changed);
    await announceConversations([conversation.id]);
    return { status: 200, body: (await conversationRecord(pool, account.id, conversation.id))! };
  });

  authed('PUT', '/api/conversations/:id/mute', async ({ account, params, body }) => {
    const { conversation } = await requireConversation(pool, account.id, params.id);
    const { duration } = jsonBody(body);
    if (typeof duration !== 'string' || (duration !== 'off' && duration !== 'always' && !(duration in MUTE_MS))) throw invalid({ duration: 'invalid' });
    const until = duration in MUTE_MS ? after(now(), MUTE_MS[duration]!) : null;
    await query(pool, 'UPDATE conversation_members SET muted_until = $3, muted_always = $4 WHERE conversation_id = $1 AND account_id = $2', [
      conversation.id,
      account.id,
      until,
      duration === 'always',
    ]);
    return { status: 200, body: (await conversationRecord(pool, account.id, conversation.id))! };
  });

  authed('PUT', '/api/contacts/:account_id/seal', async ({ account, params, body }) => {
    const shared = await requireSharedConversation(pool, account.id, params.account_id);
    const contact = (await one<AccountRow>(pool, 'SELECT * FROM accounts WHERE id = $1', [params.account_id]))!;
    const { key_id: keyId, verified } = jsonBody(body);
    if (typeof keyId !== 'string') throw invalid({ key_id: 'invalid' });
    if (keyId !== contact.key_id) throw new ApiError(409, 'stale_key', { key_id: contact.key_id });
    if (typeof verified !== 'boolean') throw invalid({ verified: 'invalid' });
    await query(
      pool,
      `INSERT INTO seals (viewer_id, contact_id, accepted_key_id, verified) VALUES ($1, $2, $3, $4)
       ON CONFLICT (viewer_id, contact_id) DO UPDATE SET accepted_key_id = EXCLUDED.accepted_key_id, verified = EXCLUDED.verified`,
      [account.id, contact.id, contact.key_id, verified],
    );
    await announceConversations([shared.conversation_id], [account.id]);
    return { status: 200, body: { account_id: contact.id, key_id: contact.key_id, seal: verified ? 'verified' : 'unverified' } };
  });
}
