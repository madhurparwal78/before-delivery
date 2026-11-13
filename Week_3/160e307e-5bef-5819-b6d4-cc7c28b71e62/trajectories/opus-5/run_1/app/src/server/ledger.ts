import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, transaction } from './db.js';
import type { ChalkReason } from '../shared/chalk.js';

/** Every chalk movement is two entries with one movementId that sum to zero. */
export async function addMovement(
  client: PoolClient,
  playerId: string,
  delta: number,
  reason: ChalkReason,
  itemId: string | null = null,
): Promise<string> {
  const movementId = randomUUID();
  await client.query(
    `insert into ledger_entries (movement_id, player_id, account, delta, reason, item_id)
     values ($1, $2, 'player', $3, $4, $5), ($1, $2, 'house', $6, $4, $5)`,
    [movementId, playerId, delta, reason, itemId, -delta],
  );
  return movementId;
}

export async function grant(
  playerId: string,
  delta: number,
  reason: ChalkReason,
  itemId: string | null = null,
): Promise<void> {
  if (delta === 0) return;
  await transaction(async (client) => {
    await addMovement(client, playerId, delta, reason, itemId);
  });
}

export async function balanceOf(client: PoolClient, playerId: string): Promise<number> {
  const result = await client.query<{ sum: string | null }>(
    "select sum(delta)::text as sum from ledger_entries where player_id = $1 and account = 'player'",
    [playerId],
  );
  const sum = result.rows[0]?.sum ?? null;
  return sum === null ? 0 : Number(sum);
}

export async function wonEarlierToday(playerId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `select id::text from ledger_entries
     where player_id = $1 and account = 'player' and reason = 'daily'
       and created_at >= date_trunc('day', now() at time zone 'utc')
     limit 1`,
    [playerId],
  );
  return rows.length > 0;
}

export async function localAwardsToday(playerId: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `select count(*)::text as count from ledger_entries
     where player_id = $1 and account = 'player' and reason = 'local'
       and created_at >= date_trunc('day', now() at time zone 'utc')`,
    [playerId],
  );
  return Number(rows[0]?.count ?? '0');
}

export async function ledgerFor(playerId: string): Promise<{
  entries: Record<string, unknown>[];
  sum: number;
}> {
  const rows = await query<{
    movement_id: string;
    account: string;
    delta: number;
    reason: string;
    item_id: string | null;
    created_at: Date;
  }>(
    `select movement_id, account, delta, reason, item_id, created_at
     from ledger_entries where player_id = $1 order by id asc`,
    [playerId],
  );
  let sum = 0;
  const entries = rows.map((row) => {
    if (row.account === 'player') sum += row.delta;
    return {
      movementId: row.movement_id,
      account: row.account,
      delta: row.delta,
      reason: row.reason,
      itemId: row.item_id,
      createdAt: row.created_at.toISOString(),
    };
  });
  return { entries, sum };
}
