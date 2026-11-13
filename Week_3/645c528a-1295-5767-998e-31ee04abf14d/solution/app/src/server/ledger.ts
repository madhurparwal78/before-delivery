/** Ledger lines: every movement of value is one pair summing to zero, and a wallet balance is only ever the sum of its lines. */
import { randomUUID } from 'node:crypto';
import type { Currency } from '../shared/domain';
import type { Db } from './db';

type Account = 'wallet' | 'escrow' | 'house' | 'system';
type LineKind =
  | 'match_entry' | 'match_win' | 'match_refund' | 'house_cut'
  | 'tournament_entry' | 'tournament_prize' | 'tournament_refund'
  | 'grant' | 'opening_balance' | 'daily_reward' | 'refill' | 'level_reward' | 'cash_purchase'
  | 'grading_adjustment' | 'cue_purchase' | 'item_purchase' | 'club_fee';

interface Side {
  account: Account;
  playerId?: string;
}

export interface LedgerRow {
  id: string;
  pair_id: string;
  player_id: string | null;
  currency: Currency;
  account: Account;
  amount: string;
  kind: string;
  ref_id: string;
  created_at: Date;
}

export const SYSTEM: Side = { account: 'system' };
export const ESCROW: Side = { account: 'escrow' };
export const HOUSE: Side = { account: 'house' };

export function wallet(playerId: string): Side {
  return { account: 'wallet', playerId };
}

export async function writePair(
  client: Db,
  movement: { from: Side; to: Side; amount: number; currency: Currency; kind: LineKind; refId: string },
): Promise<void> {
  const { from, to, amount, currency, kind, refId } = movement;
  const pairId = randomUUID();
  await client.query(
    `INSERT INTO ledger_lines (id, pair_id, player_id, currency, account, amount, kind, ref_id) VALUES
     ($1,$3,$4,$6,$7,$9,$11,$12), ($2,$3,$5,$6,$8,$10,$11,$12)`,
    [randomUUID(), randomUUID(), pairId, from.playerId ?? null, to.playerId ?? null, currency, from.account, to.account, -amount, amount, kind, refId],
  );
}

export async function balance(client: Db, playerId: string, currency: Currency): Promise<number> {
  const { rows } = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_lines WHERE player_id = $1 AND account = 'wallet' AND currency = $2`,
    [playerId, currency],
  );
  return Number(rows[0].total);
}

export function lineBody(line: LedgerRow): Record<string, unknown> {
  return {
    id: line.id,
    pairId: line.pair_id,
    playerId: line.player_id,
    currency: line.currency,
    account: line.account,
    amount: Number(line.amount),
    kind: line.kind,
    refId: line.ref_id,
    createdAt: line.created_at.toISOString(),
  };
}

/** Takes the row lock that serialises every balance change of one player. */
export async function lockPlayer(client: Db, playerId: string): Promise<void> {
  await client.query('SELECT 1 FROM players WHERE id = $1 FOR UPDATE', [playerId]);
}
