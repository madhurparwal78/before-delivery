import { AppError } from '../errors.js';
import type { Tx } from './db.js';

export const ACCOUNT_AVAILABLE = (userId: string): string => `creator:${userId}:available`;
export const ACCOUNT_HELD = (userId: string): string => `creator:${userId}:held`;

export async function balance(tx: Tx, userId: string): Promise<{ available: number; held: number }> {
  const rows = await tx.query<{ account: string; balance: string }>(
    `SELECT account, COALESCE(SUM(amount), 0)::text AS balance FROM credit_rows
     WHERE account IN ($1, $2) GROUP BY account`,
    [ACCOUNT_AVAILABLE(userId), ACCOUNT_HELD(userId)]
  );
  const out = { available: 0, held: 0 };
  for (const row of rows) {
    if (row.account === ACCOUNT_AVAILABLE(userId)) out.available = Number(row.balance);
    else out.held = Number(row.balance);
  }
  return out;
}

export async function ledgerBalance(tx: Tx, account: string): Promise<number> {
  const row = await tx.one<{ balance: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS balance FROM credit_rows WHERE account = $1`,
    [account]
  );
  return Number(row?.balance ?? 0);
}

/** Every movement is one entry with two equal and opposite rows. */
export async function writeEntry(
  tx: Tx,
  kind: 'grant' | 'pack' | 'reserve' | 'capture' | 'release',
  rows: { account: string; amount: number }[],
  renderId: string | null = null
): Promise<void> {
  const entry = await tx.one<{ id: string }>(`INSERT INTO credit_entries (kind, render_id) VALUES ($1, $2) RETURNING id::text`, [kind, renderId]);
  if (!entry) throw new Error('credit_entry_failed');
  for (const row of rows) {
    await tx.query(`INSERT INTO credit_rows (entry_id, account, amount) VALUES ($1, $2, $3)`, [entry.id, row.account, row.amount]);
  }
}

export async function grant(tx: Tx, userId: string, credits: number): Promise<void> {
  await writeEntry(tx, 'grant', [
    { account: 'platform:issued', amount: -credits },
    { account: ACCOUNT_AVAILABLE(userId), amount: credits }
  ]);
}

export async function grantPack(tx: Tx, userId: string, credits: number): Promise<void> {
  await writeEntry(tx, 'pack', [
    { account: 'platform:issued', amount: -credits },
    { account: ACCOUNT_AVAILABLE(userId), amount: credits }
  ]);
}

/**
 * Reserves the cost atomically: two renders accepted at once can never take the
 * balance below zero. The row lock on the caller's available rows serialises
 * concurrent reservations for the same creator.
 */
export async function reserve(tx: Tx, userId: string, cost: number, renderId: string): Promise<void> {
  await tx.query(`SELECT id FROM credit_rows WHERE account = $1 FOR UPDATE`, [ACCOUNT_AVAILABLE(userId)]);
  const available = await ledgerBalance(tx, ACCOUNT_AVAILABLE(userId));
  if (available < cost) throw AppError.insufficientCredits(cost, available);
  await writeEntry(tx, 'reserve', [
    { account: ACCOUNT_AVAILABLE(userId), amount: -cost },
    { account: ACCOUNT_HELD(userId), amount: cost }
  ], renderId);
}

export async function capture(tx: Tx, userId: string, cost: number, renderId: string): Promise<void> {
  await writeEntry(tx, 'capture', [
    { account: ACCOUNT_HELD(userId), amount: -cost },
    { account: 'platform:consumed', amount: cost }
  ], renderId);
}

export async function release(tx: Tx, userId: string, cost: number, renderId: string): Promise<void> {
  await writeEntry(tx, 'release', [
    { account: ACCOUNT_HELD(userId), amount: -cost },
    { account: ACCOUNT_AVAILABLE(userId), amount: cost }
  ], renderId);
}
