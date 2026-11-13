/**
 * Interest accrual. An asset's borrow index is brought forward per second of
 * server time on its kinked utilization curve, and each position's share of
 * the growth is posted as balanced legs split between the liquidity providers
 * and the reserve.
 */

import { readBig, writeInstant, type Queryable } from '../db/pool.ts';
import type { Asset } from '../domain/assets.ts';
import { borrowRateBps, debtAtIndex, indexForward } from '../domain/interest.ts';
import { splitWithReserve } from '../domain/money.ts';
import { poolFigures } from '../domain/pool.ts';
import { RESERVE, SUPPLY, loanAccount } from '../ledger/accounts.ts';
import { insertPosting, poolBalances } from '../ledger/postings.ts';
import { loadAsset } from './state.ts';

/** Server instants are recorded to the whole second, rounding down. */
export function wholeSecond(instantMs: number): number {
  return Math.floor(instantMs / 1000) * 1000;
}

interface DebtorRow {
  position_id: string;
  principal: string;
  reference_index: string;
  posted_debt: string;
}

/**
 * Brings one asset and its positions forward to `nowMs`. The caller must
 * already hold the asset's pool lock, which keeps concurrent processes from
 * accruing the same interval twice.
 */
export async function accrueAsset(
  client: Queryable,
  asset: Asset,
  nowMs: number,
): Promise<void> {
  const { settings } = await loadAsset(client, asset);
  const target = wholeSecond(nowMs);
  const elapsedSeconds = Math.floor((target - wholeSecond(settings.indexUpdatedAtMs)) / 1000);
  if (elapsedSeconds <= 0) return;

  // The rate in force at the start of the interval.
  const figures = poolFigures(await poolBalances(client, asset));
  const rate = borrowRateBps(figures.utilizationBps, settings.curve);
  const nextIndex = indexForward(settings.borrowIndex, rate, BigInt(elapsedSeconds));

  await client.query(
    'UPDATE assets SET borrow_index = $1, index_updated_at = $2 WHERE asset = $3',
    [nextIndex.toString(), writeInstant(target), asset],
  );

  if (nextIndex === settings.borrowIndex) return;

  const debtors = await client.query<DebtorRow>(
    `SELECT p.position_id, p.principal, p.reference_index,
            COALESCE(-(SELECT SUM(l.amount) FROM ledger_legs l
                       WHERE l.account = 'loan:' || p.position_id AND l.asset = p.debt_asset), 0)::text
              AS posted_debt
     FROM positions p
     WHERE p.debt_asset = $1 AND p.state <> 'closed' AND p.principal > 0
     ORDER BY p.position_id`,
    [asset],
  );

  for (const row of debtors.rows) {
    const principal = readBig(row.principal);
    const referenceIndex = readBig(row.reference_index);
    const postedDebt = readBig(row.posted_debt);
    const debtNow = debtAtIndex(principal, referenceIndex, nextIndex);
    const interest = debtNow - postedDebt;
    if (interest <= 0n) continue;
    const split = splitWithReserve(interest, settings.reserveFactorBps);
    await insertPosting(client, {
      kind: 'accrual',
      ref: row.position_id,
      createdAtMs: target,
      legs: [
        { account: loanAccount(row.position_id), asset, amount: -interest },
        ...(split.toSupply > 0n ? [{ account: SUPPLY, asset, amount: split.toSupply }] : []),
        ...(split.toReserve > 0n ? [{ account: RESERVE, asset, amount: split.toReserve }] : []),
      ],
    });
  }
}
