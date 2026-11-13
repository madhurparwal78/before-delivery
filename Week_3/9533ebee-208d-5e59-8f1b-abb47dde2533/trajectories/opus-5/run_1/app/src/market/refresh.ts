/**
 * Brings the market forward. The server accrues interest and re-evaluates
 * every open position before any read or write that shows or uses a debt, and
 * the background sweep calls the same path at least every 5 seconds.
 */

import { query, transaction, writeInstant } from '../db/pool.ts';
import { ASSET_CODES } from '../domain/assets.ts';
import { accrueAsset, wholeSecond } from './accrual.ts';
import { evaluateAllOpenPositions } from './positions.ts';
import { loadAssets } from './state.ts';

/**
 * True when either an asset's index has fallen behind the current second or a
 * stored grace end has passed. When neither holds, no state can have moved
 * since the last evaluation, because prices only change through a post and a
 * post evaluates the book itself.
 */
async function workIsDue(nowMs: number): Promise<boolean> {
  const second = writeInstant(wholeSecond(nowMs));
  const result = await query<{ accrual_due: boolean; grace_due: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM assets WHERE index_updated_at < $1) AS accrual_due,
       EXISTS (SELECT 1 FROM positions
               WHERE state = 'liquidatable_grace' AND grace_ends_at IS NOT NULL
                 AND grace_ends_at <= $1) AS grace_due`,
    [second],
  );
  const row = result.rows[0];
  return row !== undefined && (row.accrual_due || row.grace_due);
}

/**
 * Accrues every asset and evaluates every open position in one transaction.
 * Concurrent processes serialise on the asset locks, so one interval is never
 * accrued twice.
 */
export async function refreshMarket(nowMs: number): Promise<void> {
  if (!(await workIsDue(nowMs))) return;
  await transaction(async (client) => {
    await client.query('SELECT asset FROM assets ORDER BY asset FOR UPDATE');
    for (const asset of ASSET_CODES) {
      await accrueAsset(client, asset, nowMs);
    }
    const assets = await loadAssets(client);
    await evaluateAllOpenPositions(client, assets, nowMs);
  });
}
