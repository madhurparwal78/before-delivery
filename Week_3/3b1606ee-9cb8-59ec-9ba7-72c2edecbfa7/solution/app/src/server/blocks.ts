import { requireAccount } from './access.js';
import { now } from './clock.js';
import { announceConversations } from './events.js';
import { one, pool, query, type Queryable } from './db.js';
import { authed, invalid } from './http.js';
import { iso } from './records.js';

interface BlockRow {
  blocker_id: string;
  blocked_id: string;
  blocked_at: Date;
}

export async function isBlocked(db: Queryable, blockerId: string, blockedId: string): Promise<boolean> {
  return (await one<BlockRow>(db, 'SELECT * FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [blockerId, blockedId])) !== null;
}

async function conversationsWith(blockerId: string, otherId: string): Promise<string[]> {
  const rows = await query<{ conversation_id: string }>(
    pool,
    `SELECT me.conversation_id FROM conversation_members me
     JOIN conversation_members them ON them.conversation_id = me.conversation_id
     WHERE me.account_id = $1 AND them.account_id = $2`,
    [blockerId, otherId],
  );
  return rows.map((row) => row.conversation_id);
}

export function registerBlockRoutes(): void {
  authed('GET', '/api/blocks', async ({ account }) => {
    const rows = await query<BlockRow & { username: string }>(
      pool,
      `SELECT b.*, a.username FROM blocks b JOIN accounts a ON a.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY b.blocked_at, a.username`,
      [account.id],
    );
    return { status: 200, body: { blocks: rows.map((row) => ({ account_id: row.blocked_id, username: row.username, blocked_at: iso(row.blocked_at) })) } };
  });

  authed('PUT', '/api/blocks/:account_id', async ({ account, params }) => {
    const target = await requireAccount(pool, params.account_id);
    if (target.id === account.id) throw invalid({ account_id: 'self' });
    await query(pool, 'INSERT INTO blocks (blocker_id, blocked_id, blocked_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [account.id, target.id, now()]);
    const block = (await one<BlockRow>(pool, 'SELECT * FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [account.id, target.id]))!;
    await query(
      pool,
      `UPDATE conversation_members SET status = 'deleted'
       WHERE account_id = $1 AND status = 'request' AND conversation_id IN (SELECT unnest($2::uuid[]))`,
      [account.id, await conversationsWith(account.id, target.id)],
    );
    await announceConversations(await conversationsWith(account.id, target.id), [account.id]);
    return { status: 200, body: { account_id: target.id, username: target.username, blocked_at: iso(block.blocked_at) } };
  });

  authed('DELETE', '/api/blocks/:account_id', async ({ account, params }) => {
    const target = await requireAccount(pool, params.account_id);
    await query(pool, 'DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [account.id, target.id]);
    await announceConversations(await conversationsWith(account.id, target.id), [account.id]);
    return { status: 204 };
  });
}
