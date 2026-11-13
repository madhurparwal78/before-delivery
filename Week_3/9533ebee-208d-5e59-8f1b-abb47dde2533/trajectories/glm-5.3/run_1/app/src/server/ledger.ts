import type { Tx } from './db.js';
import type { AssetCode, Leg } from '../shared/types.js';
import { problem } from './problems.js';
import {
  advanceIndex, borrowRateBps, debtAt, poolFigures, splitFee, supplyRateBps,
} from './domain.js';
import { ASSETS } from '../shared/assets.js';

export interface PostLeg {
  account: string;
  asset: AssetCode;
  amount: bigint;
}

/** Append a balanced posting and update the materialised balances. */
export async function appendPosting(
  tx: Tx,
  kind: string,
  legs: PostLeg[],
  ref: string | null,
  at: Date,
): Promise<number> {
  const perAsset = new Map<AssetCode, bigint>();
  for (const leg of legs) {
    if (leg.amount === 0n) continue;
    perAsset.set(leg.asset, (perAsset.get(leg.asset) ?? 0n) + leg.amount);
  }
  for (const sum of perAsset.values()) {
    if (sum !== 0n) {
      throw problem(500, 'internal_error', 'Something went wrong on our side \u2013 nothing is confirmed.');
    }
  }
  const posted = await tx.query<{ posting_id: string }>(
    'INSERT INTO postings (kind, ref, created_at) VALUES ($1, $2, $3) RETURNING posting_id',
    [kind, ref, at],
  );
  const postingId = Number(posted.rows[0].posting_id);
  let seq = 0;
  for (const leg of legs) {
    if (leg.amount === 0n) continue;
    await tx.query(
      'INSERT INTO legs (posting_id, seq, account, asset, amount) VALUES ($1, $2, $3, $4, $5)',
      [postingId, seq, leg.account, leg.asset, leg.amount.toString()],
    );
    await tx.query(
      `INSERT INTO balances (account, asset, balance) VALUES ($1, $2, $3)
       ON CONFLICT (account, asset) DO UPDATE SET balance = balances.balance + EXCLUDED.balance`,
      [leg.account, leg.asset, leg.amount.toString()],
    );
    seq += 1;
  }
  return postingId;
}

export async function accountBalance(client: Tx['client'], account: string, asset: AssetCode): Promise<bigint> {
  const result = await client.query<{ balance: string }>(
    'SELECT balance FROM balances WHERE account = $1 AND asset = $2',
    [account, asset],
  );
  return result.rows.length > 0 ? BigInt(result.rows[0].balance) : 0n;
}

export interface PoolRow {
  asset: AssetCode;
  total_shares: string;
  borrow_index: string;
  index_brought_to: string;
  params_version: string;
  ltv_bps: number;
  liquidation_threshold_bps: number;
  liquidation_bonus_bps: number;
  reserve_factor_bps: number;
  close_factor_bps: number;
  swap_fee_bps: number;
  curve_base_bps: number;
  curve_slope1_bps: number;
  curve_kink_bps: number;
  curve_slope2_bps: number;
  warning_hf_num: string;
}

export async function lockPoolRow(tx: Tx, asset: AssetCode): Promise<PoolRow> {
  const result = await tx.query<PoolRow>('SELECT * FROM pools WHERE asset = $1 FOR UPDATE', [asset]);
  return result.rows[0];
}

export async function readPoolRow(client: Tx['client'], asset: AssetCode): Promise<PoolRow> {
  const result = await client.query<PoolRow>('SELECT * FROM pools WHERE asset = $1', [asset]);
  return result.rows[0];
}

export interface PoolBalancesRow {
  supply: bigint;
  swap: bigint;
  loan: bigint;
}

export async function poolBalances(client: Tx['client'], asset: AssetCode): Promise<PoolBalancesRow> {
  const result = await client.query<{ account: string; balance: string }>(
    'SELECT account, balance FROM balances WHERE asset = $1 AND account IN ($2, $3)',
    [asset, 'supply', 'swap'],
  );
  let supply = 0n;
  let swap = 0n;
  for (const row of result.rows) {
    if (row.account === 'supply') supply = BigInt(row.balance);
    if (row.account === 'swap') swap = BigInt(row.balance);
  }
  const loanResult = await client.query<{ total: string | null }>(
    `SELECT COALESCE(SUM(balance), 0)::numeric(78,0)::text AS total FROM balances
     WHERE asset = $1 AND account LIKE 'loan:%'`,
    [asset],
  );
  return { supply, swap, loan: BigInt(loanResult.rows[0].total ?? '0') };
}

/** Bring an asset's borrow index and every open position's debt forward to nowSec. */
export async function accrueAsset(tx: Tx, asset: AssetCode, nowSec: number): Promise<void> {
  const row = await lockPoolRow(tx, asset);
  const last = Number(row.index_brought_to);
  if (nowSec <= last) return;
  const balances = await poolBalances(tx.client, asset);
  const figures = poolFigures(balances);
  const rate = borrowRateBps(
    { base_bps: row.curve_base_bps, slope1_bps: row.curve_slope1_bps, kink_bps: row.curve_kink_bps, slope2_bps: row.curve_slope2_bps },
    figures.utilization_bps,
  );
  const dt = BigInt(nowSec - last);
  const oldIndex = BigInt(row.borrow_index);
  const newIndex = advanceIndex(oldIndex, rate, dt);
  const positions = await tx.query<{ position_id: string; principal: string; reference_index: string; posted_debt: string }>(
    'SELECT position_id, principal, reference_index, posted_debt FROM positions WHERE debt_asset = $1 AND state <> $2 ORDER BY position_id FOR UPDATE',
    [asset, 'closed'],
  );
  const accrued: Array<{ positionId: string; debt: bigint; interest: bigint }> = [];
  let totalInterest = 0n;
  for (const position of positions.rows) {
    const principal = BigInt(position.principal);
    if (principal === 0n) continue;
    const debtNow = debtAt(principal, newIndex, BigInt(position.reference_index));
    const interest = debtNow - BigInt(position.posted_debt);
    if (interest > 0n) {
      accrued.push({ positionId: position.position_id, debt: debtNow, interest });
      totalInterest += interest;
    }
  }
  if (totalInterest > 0n) {
    const { to_supply, to_reserve } = splitFee(totalInterest, row.reserve_factor_bps);
    const legs: PostLeg[] = [
      { account: 'supply', asset, amount: to_supply },
      { account: 'reserve', asset, amount: to_reserve },
    ];
    for (const item of accrued) {
      legs.push({ account: `loan:${item.positionId}`, asset, amount: -item.interest });
      await tx.query(
        'UPDATE positions SET posted_debt = $1, debt = $1, updated_at = now() WHERE position_id = $2',
        [item.debt.toString(), item.positionId],
      );
    }
    await appendPosting(tx, 'accrual', legs, null, new Date(nowSec * 1000));
  }
  await tx.query(
    'UPDATE pools SET borrow_index = $1, index_brought_to = $2 WHERE asset = $3',
    [newIndex.toString(), nowSec, asset],
  );
}

export function poolRates(row: PoolRow, utilization_bps: number): { borrow_rate_bps: number; supply_rate_bps: number } {
  const borrow = borrowRateBps(
    { base_bps: row.curve_base_bps, slope1_bps: row.curve_slope1_bps, kink_bps: row.curve_kink_bps, slope2_bps: row.curve_slope2_bps },
    utilization_bps,
  );
  return { borrow_rate_bps: borrow, supply_rate_bps: supplyRateBps(borrow, utilization_bps, row.reserve_factor_bps) };
}

export function walletAccount(actorId: string): string {
  return `wallet:${actorId}`;
}

export function collateralAccount(positionId: string): string {
  return `collateral:${positionId}`;
}

export function loanAccount(positionId: string): string {
  return `loan:${positionId}`;
}

export function decimalsOf(asset: AssetCode): number {
  return ASSETS[asset].decimals;
}

export type { Leg };
