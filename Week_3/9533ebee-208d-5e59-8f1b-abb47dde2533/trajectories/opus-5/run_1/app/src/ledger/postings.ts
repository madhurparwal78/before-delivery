/**
 * Writing and reading the double-entry ledger. Every movement is one posting
 * of legs whose amounts sum to zero per asset. Postings are never edited.
 */

import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/pool.ts';
import { readBig, writeInstant } from '../db/pool.ts';
import { ASSET_CODES, type Asset } from '../domain/assets.ts';
import type { PoolBalances } from '../domain/pool.ts';
import { RESERVE, SUPPLY, SWAP, type PostingKind } from './accounts.ts';

export interface Leg {
  readonly account: string;
  readonly asset: Asset;
  readonly amount: bigint;
}

export interface PostingInput {
  readonly kind: PostingKind;
  readonly ref: string | null;
  readonly createdAtMs: number;
  readonly legs: readonly Leg[];
}

/** Thrown only when a caller builds legs that do not balance, which is a bug. */
class UnbalancedPosting extends Error {}

function assertBalanced(legs: readonly Leg[]): void {
  const perAsset = new Map<Asset, bigint>();
  for (const leg of legs) {
    if (leg.amount === 0n) throw new UnbalancedPosting('A leg amount is zero');
    perAsset.set(leg.asset, (perAsset.get(leg.asset) ?? 0n) + leg.amount);
  }
  for (const [asset, total] of perAsset) {
    if (total !== 0n) throw new UnbalancedPosting(`Legs of ${asset} sum to ${total}`);
  }
}

/** Writes one posting and its legs, and returns the posting id. */
export async function insertPosting(client: Queryable, input: PostingInput): Promise<string> {
  assertBalanced(input.legs);
  const postingId = randomUUID();
  const createdAt = writeInstant(input.createdAtMs);
  await client.query(
    'INSERT INTO ledger_postings (posting_id, kind, ref, created_at) VALUES ($1, $2, $3, $4)',
    [postingId, input.kind, input.ref, createdAt],
  );
  const values: unknown[] = [];
  const rows: string[] = [];
  input.legs.forEach((leg, index) => {
    const base = index * 5;
    rows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
    values.push(postingId, index, leg.account, leg.asset, leg.amount.toString());
  });
  await client.query(
    `INSERT INTO ledger_legs (posting_id, leg_index, account, asset, amount, created_at)
     SELECT v.posting_id::uuid, v.leg_index::integer, v.account::text, v.asset::text,
            v.amount::numeric, $${values.length + 1}
     FROM (VALUES ${rows.join(', ')})
       AS v(posting_id, leg_index, account, asset, amount)`,
    [...values, createdAt],
  );
  return postingId;
}

/**
 * Locks an asset's pool for the rest of the transaction. Withdrawals, draws
 * and swap outputs take this lock before they read available liquidity, so
 * they are served one at a time across every server process.
 */
export async function lockPool(client: Queryable, asset: Asset): Promise<void> {
  await client.query('SELECT asset FROM assets WHERE asset = $1 FOR UPDATE', [asset]);
}

export async function accountBalance(
  client: Queryable,
  account: string,
  asset: Asset,
): Promise<bigint> {
  const result = await client.query<{ balance: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS balance
     FROM ledger_legs WHERE account = $1 AND asset = $2`,
    [account, asset],
  );
  return readBig(result.rows[0]?.balance ?? '0');
}

/** The balances every pool figure is computed from. */
export async function poolBalances(client: Queryable, asset: Asset): Promise<PoolBalances> {
  const result = await client.query<{
    supply: string;
    reserve: string;
    swap: string;
    loan_total: string;
  }>(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE account = $2), 0)::text AS supply,
       COALESCE(SUM(amount) FILTER (WHERE account = $3), 0)::text AS reserve,
       COALESCE(SUM(amount) FILTER (WHERE account = $4), 0)::text AS swap,
       COALESCE(SUM(amount) FILTER (WHERE account LIKE 'loan:%'), 0)::text AS loan_total
     FROM ledger_legs WHERE asset = $1`,
    [asset, SUPPLY, RESERVE, SWAP],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return { supply: 0n, reserve: 0n, swap: 0n, loanTotal: 0n };
  }
  return {
    supply: readBig(row.supply),
    reserve: readBig(row.reserve),
    swap: readBig(row.swap),
    loanTotal: readBig(row.loan_total),
  };
}

/** A member's free balance in every listed asset. */
export async function walletBalances(
  client: Queryable,
  actorId: string,
): Promise<Record<Asset, bigint>> {
  const result = await client.query<{ asset: string; balance: string }>(
    `SELECT asset, SUM(amount)::text AS balance
     FROM ledger_legs WHERE account = $1 GROUP BY asset`,
    [`wallet:${actorId}`],
  );
  const balances: Record<Asset, bigint> = { QUSD: 0n, MBTC: 0n, METH: 0n };
  for (const row of result.rows) {
    const asset = row.asset as Asset;
    if (asset in balances) balances[asset] = readBig(row.balance);
  }
  return balances;
}

export interface AssetTotals {
  readonly asset: Asset;
  readonly debits: bigint;
  readonly credits: bigint;
  readonly net: bigint;
}

/**
 * The trial balance: debits are the sum of positive legs, credits the
 * absolute sum of negative legs, and net is debits minus credits.
 */
export async function trialBalance(client: Queryable): Promise<AssetTotals[]> {
  const result = await client.query<{ asset: string; debits: string; credits: string }>(
    `SELECT asset,
       COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0)::text AS debits,
       COALESCE(-SUM(amount) FILTER (WHERE amount < 0), 0)::text AS credits
     FROM ledger_legs GROUP BY asset`,
  );
  const byAsset = new Map(result.rows.map((row) => [row.asset, row]));
  return ASSET_CODES.map((asset) => {
    const row = byAsset.get(asset);
    const debits = readBig(row?.debits ?? '0');
    const credits = readBig(row?.credits ?? '0');
    return { asset, debits, credits, net: debits - credits };
  });
}

export interface AccountBalanceRow {
  readonly account: string;
  readonly asset: Asset;
  readonly balance: bigint;
}

export async function accountBalances(
  client: Queryable,
  asset: Asset,
): Promise<AccountBalanceRow[]> {
  const result = await client.query<{ account: string; asset: string; balance: string }>(
    `SELECT account, asset, SUM(amount)::text AS balance
     FROM ledger_legs WHERE asset = $1
     GROUP BY account, asset ORDER BY account`,
    [asset],
  );
  return result.rows.map((row) => ({
    account: row.account,
    asset: row.asset as Asset,
    balance: readBig(row.balance),
  }));
}

export interface PostingRecord {
  readonly postingId: string;
  readonly kind: string;
  readonly ref: string | null;
  readonly createdAtMs: number;
  readonly legs: readonly Leg[];
}

export interface PostingFilter {
  readonly asset: Asset | null;
  readonly limit: number;
  readonly fromMs: number | null;
  readonly toMs: number | null;
}

/**
 * The filtered postings, newest first. `from` and `to` make a half-open
 * window on `created_at`. One row per leg is returned to the caller grouped
 * by posting; a posting is listed when any of its legs matches the asset.
 */
export async function listPostings(
  client: Queryable,
  filter: PostingFilter,
): Promise<PostingRecord[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filter.asset !== null) {
    values.push(filter.asset);
    conditions.push(
      `EXISTS (SELECT 1 FROM ledger_legs l WHERE l.posting_id = p.posting_id AND l.asset = $${values.length})`,
    );
  }
  if (filter.fromMs !== null) {
    values.push(writeInstant(filter.fromMs));
    conditions.push(`p.created_at >= $${values.length}`);
  }
  if (filter.toMs !== null) {
    values.push(writeInstant(filter.toMs));
    conditions.push(`p.created_at < $${values.length}`);
  }
  values.push(filter.limit);
  const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
  const result = await client.query<{
    posting_id: string;
    kind: string;
    ref: string | null;
    created_at: Date;
    legs: Array<{ account: string; asset: string; amount: string }>;
  }>(
    `SELECT p.posting_id, p.kind, p.ref, p.created_at,
       (SELECT json_agg(json_build_object('account', l.account, 'asset', l.asset,
                                          'amount', l.amount::text) ORDER BY l.leg_index)
        FROM ledger_legs l WHERE l.posting_id = p.posting_id) AS legs
     FROM ledger_postings p
     ${where}
     ORDER BY p.created_at DESC, p.posting_id DESC
     LIMIT $${values.length}`,
    values,
  );
  return result.rows.map((row) => ({
    postingId: row.posting_id,
    kind: row.kind,
    ref: row.ref,
    createdAtMs: row.created_at.getTime(),
    legs: row.legs.map((leg) => ({
      account: leg.account,
      asset: leg.asset as Asset,
      amount: readBig(leg.amount),
    })),
  }));
}
