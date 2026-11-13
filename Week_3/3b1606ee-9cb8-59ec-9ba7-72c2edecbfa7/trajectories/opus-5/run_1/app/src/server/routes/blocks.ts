import type { BlockRecord } from '../../shared/types.js';
import { serverNow } from '../clock.js';
import { pool } from '../db.js';
import {
  invalidField,
  isUuidV4,
  notFound,
  sendJson,
  sendNoContent,
  type RequestContext,
} from '../http.js';
import { pushConversation } from '../push.js';
import { hideConversation } from './conversations.js';

export async function getBlocks(ctx: RequestContext): Promise<void> {
  const rows = await pool.query<{ account_id: string; username: string; blocked_at: Date }>(
    `select b.blocked_id as account_id, a.username, b.blocked_at
       from blocks b join accounts a on a.id = b.blocked_id
      where b.blocker_id = $1 order by b.blocked_at desc`,
    [ctx.accountId],
  );
  const blocks: BlockRecord[] = rows.rows.map((row) => ({
    account_id: row.account_id,
    username: row.username,
    blocked_at: row.blocked_at.toISOString(),
  }));
  sendJson(ctx.res, 200, { blocks });
}

async function sharedConversation(
  accountId: string,
  otherId: string,
): Promise<{ conversation_id: string; accepted: boolean } | null> {
  const result = await pool.query<{ conversation_id: string; accepted: boolean }>(
    `select mine.conversation_id, mine.accepted from conversation_sides mine
       join conversation_sides theirs on theirs.conversation_id = mine.conversation_id
      where mine.account_id = $1 and theirs.account_id = $2`,
    [accountId, otherId],
  );
  return result.rows[0] ?? null;
}

export async function putBlock(ctx: RequestContext): Promise<void> {
  const blockedId = ctx.params['account_id'] ?? '';
  if (!isUuidV4(blockedId)) throw notFound();
  const exists = await pool.query('select username from accounts where id = $1', [blockedId]);
  if (exists.rows.length === 0) throw notFound();
  if (blockedId === ctx.accountId) throw invalidField('account_id', 'self');

  const now = serverNow();
  const result = await pool.query<{ blocked_at: Date }>(
    `insert into blocks (blocker_id, blocked_id, blocked_at) values ($1, $2, $3)
     on conflict (blocker_id, blocked_id) do update set blocked_at = blocks.blocked_at
     returning blocked_at`,
    [ctx.accountId, blockedId, now],
  );

  const shared = await sharedConversation(ctx.accountId, blockedId);
  if (shared !== null) {
    // Blocking a request also takes it out of sight.
    if (!shared.accepted) await hideConversation(shared.conversation_id, ctx.accountId);
    await pushConversation(shared.conversation_id, [ctx.accountId]);
  }

  const username = (exists.rows[0] as { username: string }).username;
  sendJson(ctx.res, 200, {
    account_id: blockedId,
    username,
    blocked_at: (result.rows[0]?.blocked_at ?? now).toISOString(),
  } satisfies BlockRecord);
}

export async function deleteBlock(ctx: RequestContext): Promise<void> {
  const blockedId = ctx.params['account_id'] ?? '';
  if (!isUuidV4(blockedId)) throw notFound();
  const exists = await pool.query('select 1 from accounts where id = $1', [blockedId]);
  if (exists.rows.length === 0) throw notFound();

  await pool.query('delete from blocks where blocker_id = $1 and blocked_id = $2', [
    ctx.accountId,
    blockedId,
  ]);
  const shared = await sharedConversation(ctx.accountId, blockedId);
  if (shared !== null) await pushConversation(shared.conversation_id, [ctx.accountId]);
  sendNoContent(ctx.res);
}
