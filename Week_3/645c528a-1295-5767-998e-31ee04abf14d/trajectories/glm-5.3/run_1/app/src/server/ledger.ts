import type { PoolClient } from 'pg';
import type { Db } from './db.js';
import { id } from './util.js';
import type { LedgerLine } from '../shared/types.js';

export type Currency = 'coins' | 'cash';
export type Account = 'wallet' | 'escrow' | 'house' | 'system';

export interface LineSpec {
  playerId: string | null;
  currency: Currency;
  account: Account;
  amount: number;
}

export interface MovementSpec {
  kind: string;
  refId: string | null;
  currency: Currency;
  lines: [LineSpec, LineSpec];
}

/**
 * Writes one balanced pair of ledger lines and applies the wallet delta.
 * The two amounts must sum to zero and the pair shares one pairId.
 * Wallet balances are derived: a player's balance is the sum of their wallet lines.
 */
export async function writePair(client: PoolClient, spec: MovementSpec): Promise<string> {
  const [a, b] = spec.lines;
  if (a.amount + b.amount !== 0) throw new Error('ledger pair is not balanced');
  const pairId = id('pair');
  await ensureEscrow(client, spec.refId, spec.currency, a, b);
  const rows = [a, b].map((line) => ({
    id: id('line'),
    pairId,
    playerId: line.playerId,
    currency: line.currency,
    account: line.account,
    amount: line.amount,
    kind: spec.kind,
    refId: spec.refId,
  }));
  for (const row of rows) {
    await client.query(
      `INSERT INTO ledger_lines (id, pair_id, player_id, currency, account, amount, kind, ref_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [row.id, row.pairId, row.playerId, row.currency, row.account, row.amount, row.kind, row.refId]
    );
  }
  return pairId;
}

async function ensureEscrow(client: PoolClient, refId: string | null, currency: Currency, a: LineSpec, b: LineSpec): Promise<void> {
  if (!refId) return;
  const accounts = [a.account, b.account];
  if (!accounts.includes('escrow')) return;
  await client.query(
    `INSERT INTO escrow_accounts (ref_id, currency, balance) VALUES ($1,$2,0)
     ON CONFLICT (ref_id) DO NOTHING`,
    [refId, currency]
  );
}

export async function walletBalance(client: PoolClient | Db, playerId: string, currency: Currency): Promise<number> {
  const res = await client.query<{ sum: string }>(
    `SELECT COALESCE(SUM(amount),0) AS sum FROM ledger_lines
     WHERE player_id = $1 AND currency = $2 AND account = 'wallet'`,
    [playerId, currency]
  );
  return Number(res.rows[0]?.sum ?? 0);
}

export async function ledgerLines(client: PoolClient, playerId: string, currency: Currency, limit = 50): Promise<LedgerLine[]> {
  const res = await client.query<LedgerLine>(
    `SELECT id, pair_id AS "pairId", player_id AS "playerId", currency, account, amount, kind,
            ref_id AS "refId", created_at AS "createdAt"
     FROM ledger_lines
     WHERE player_id = $1 AND currency = $2 AND account = 'wallet'
     ORDER BY created_at DESC, id DESC
     LIMIT $3`,
    [playerId, currency, limit]
  );
  return res.rows.map(rowToLine);
}

export function rowToLine(row: LedgerLine & { createdAt: Date | string }): LedgerLine {
  return { ...row, createdAt: new Date(row.createdAt).toISOString() };
}

export async function spendableWallets(client: PoolClient, playerId: string): Promise<{ coins: number; cash: number }> {
  const [coins, cash] = await Promise.all([walletBalance(client, playerId, 'coins'), walletBalance(client, playerId, 'cash')]);
  return { coins, cash };
}
