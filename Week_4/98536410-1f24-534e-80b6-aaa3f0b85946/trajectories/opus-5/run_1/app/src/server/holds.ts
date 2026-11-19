import { randomUUID } from 'node:crypto';
import { asNumber, query, withTransaction } from './db.js';
import type { Queryable } from './db.js';
import { config } from './config.js';
import { claimStock, releaseHeldUnits } from './stock.js';

export type ReleaseReason = 'window_ended' | 'deleted' | 'cart_change';

/**
 * Moves a hold from active to released exactly once and gives its units back once.
 * Whichever caller wins the conditional update does the work; the losers change nothing.
 */
export async function releaseHoldWithin(
  tx: Queryable,
  holdId: string,
  reason: ReleaseReason,
): Promise<boolean> {
  const claimed = await tx.query(
    `UPDATE holds SET status = 'released', released_at = now(), release_reason = $2
      WHERE id = $1 AND status = 'active' RETURNING store_id`,
    [holdId, reason],
  );
  const row = claimed.rows[0];
  if (!row) return false;
  const lines = (
    await tx.query(`SELECT sku, quantity FROM hold_lines WHERE hold_id = $1`, [holdId])
  ).rows;
  await releaseHeldUnits(
    tx,
    row['store_id'] as string,
    lines.map((line) => ({ sku: line['sku'] as string, quantity: asNumber(line['quantity']) })),
  );
  return true;
}

export async function releaseHoldOnce(holdId: string, reason: ReleaseReason): Promise<boolean> {
  return withTransaction((tx) => releaseHoldWithin(tx, holdId, reason));
}

export async function releaseActiveHoldOfShopper(
  tx: Queryable,
  userId: string,
): Promise<void> {
  const rows = (
    await tx.query(`SELECT id FROM holds WHERE user_id = $1 AND status = 'active'`, [userId])
  ).rows;
  for (const row of rows) {
    await releaseHoldWithin(tx, row['id'] as string, 'cart_change');
  }
}

export async function createHold(
  operatorId: string,
  userId: string,
  storeId: string,
  lines: { sku: string; quantity: number }[],
): Promise<string> {
  return withTransaction(async (tx) => {
    const holdId = randomUUID();
    await claimStock(tx, storeId, lines);
    await tx.query(
      `INSERT INTO holds (id, operator_id, user_id, store_id, status, created_at, expires_at)
       VALUES ($1,$2,$3,$4,'active', now(), now() + ($5 || ' seconds')::interval)`,
      [holdId, operatorId, userId, storeId, String(config.holdSeconds)],
    );
    for (const line of [...lines].sort((a, b) => (a.sku < b.sku ? -1 : 1))) {
      await tx.query(
        `INSERT INTO hold_lines (hold_id, sku, quantity) VALUES ($1,$2,$3)`,
        [holdId, line.sku, line.quantity],
      );
    }
    return holdId;
  });
}

/** The background sweep every app copy runs, so an abandoned hold frees its units. */
async function sweepEndedHolds(): Promise<void> {
  const rows = await query(
    `SELECT id FROM holds WHERE status = 'active' AND expires_at <= now() LIMIT 200`,
  );
  for (const row of rows) {
    await releaseHoldOnce(row['id'] as string, 'window_ended');
  }
}

export function startHoldSweep(): void {
  void sweepEndedHolds();
  setInterval(() => void sweepEndedHolds().catch(() => undefined), config.holdSweepSeconds * 1000).unref();
}
