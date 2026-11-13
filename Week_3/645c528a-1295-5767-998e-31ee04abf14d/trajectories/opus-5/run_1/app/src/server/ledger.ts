import { randomUUID } from 'node:crypto';
import type { Queryable } from './db.js';

export type Currency = 'coins' | 'cash';
export type Account = 'wallet' | 'escrow' | 'house' | 'system';

export interface LedgerSide {
  account: Account;
  playerId: string | null;
}

export interface PairSpec {
  currency: Currency;
  kind: string;
  amount: number;
  negative: LedgerSide;
  positive: LedgerSide;
  refId: string | null;
}

/** Every movement of value is exactly two lines in one currency sharing a pairId. */
export async function writePair(client: Queryable, spec: PairSpec): Promise<void> {
  if (spec.amount <= 0) throw new Error('ledger pair amount must be positive');
  const pairId = randomUUID();
  const column = spec.currency === 'coins' ? 'coins' : 'cash';
  for (const [side, amount] of [
    [spec.negative, -spec.amount],
    [spec.positive, spec.amount],
  ] as const) {
    await client.query(
      `INSERT INTO ledger_lines (id, pair_id, player_id, currency, account, amount, kind, ref_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), pairId, side.account === 'wallet' ? side.playerId : null, spec.currency, side.account, amount, spec.kind, spec.refId],
    );
    if (side.account === 'wallet' && side.playerId) {
      await client.query(`UPDATE players SET ${column} = ${column} + $1 WHERE id = $2`, [amount, side.playerId]);
    }
  }
}

export async function credit(
  client: Queryable,
  playerId: string,
  currency: Currency,
  amount: number,
  kind: string,
  refId: string | null = null,
): Promise<void> {
  await writePair(client, {
    currency,
    kind,
    amount,
    negative: { account: 'system', playerId: null },
    positive: { account: 'wallet', playerId },
    refId,
  });
}

export async function spend(
  client: Queryable,
  playerId: string,
  currency: Currency,
  amount: number,
  kind: string,
  refId: string | null = null,
): Promise<void> {
  await writePair(client, {
    currency,
    kind,
    amount,
    negative: { account: 'wallet', playerId },
    positive: { account: 'system', playerId: null },
    refId,
  });
}

export async function toEscrow(
  client: Queryable,
  playerId: string,
  amount: number,
  kind: string,
  refId: string,
): Promise<void> {
  await writePair(client, {
    currency: 'coins',
    kind,
    amount,
    negative: { account: 'wallet', playerId },
    positive: { account: 'escrow', playerId: null },
    refId,
  });
}

export async function fromEscrow(
  client: Queryable,
  playerId: string,
  amount: number,
  kind: string,
  refId: string,
): Promise<void> {
  await writePair(client, {
    currency: 'coins',
    kind,
    amount,
    negative: { account: 'escrow', playerId: null },
    positive: { account: 'wallet', playerId },
    refId,
  });
}

export async function houseCut(client: Queryable, amount: number, refId: string): Promise<void> {
  await writePair(client, {
    currency: 'coins',
    kind: 'house_cut',
    amount,
    negative: { account: 'escrow', playerId: null },
    positive: { account: 'house', playerId: null },
    refId,
  });
}

export interface LedgerLineRow {
  id: string;
  pair_id: string;
  player_id: string | null;
  currency: string;
  account: string;
  amount: string | number;
  kind: string;
  ref_id: string | null;
  created_at: Date;
}

export function serialiseLine(row: LedgerLineRow): Record<string, unknown> {
  return {
    id: row.id,
    pairId: row.pair_id,
    playerId: row.account === 'wallet' ? row.player_id : null,
    currency: row.currency,
    account: row.account,
    amount: Number(row.amount),
    kind: row.kind,
    refId: row.ref_id,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
