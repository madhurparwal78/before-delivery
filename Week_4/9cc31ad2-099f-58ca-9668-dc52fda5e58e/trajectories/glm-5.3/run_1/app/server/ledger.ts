// The coin ledger. Every movement is two entries that sum to zero.
import type { Db } from './db.js';
import { shortId } from './ids.js';

export type MovementKind = 'opening' | 'finals' | 'pickups' | 'result' | 'upgrade' | 'car' | 'refit';

const COUNTER_ACCOUNTS: Record<MovementKind, string> = {
  opening: 'house:grants',
  finals: 'house:grants',
  pickups: 'house:pickups',
  result: 'house:results',
  upgrade: 'house:shop',
  car: 'house:shop',
  refit: 'house:refits'
};

/** The balance is the sum of the wallet entries. */
export async function balanceOf(db: Db, playerId: string): Promise<number> {
  const r = await db.query('SELECT COALESCE(SUM(wallet_amount), 0)::int AS balance FROM ledger WHERE player_id = $1', [playerId]);
  return r.rows[0].balance as number;
}

/** Writes one movement with its two entries, inside the caller's transaction. */
export async function writeMovement(db: Db, playerId: string, kind: MovementKind, amount: number,
                                    runId: string | null, movementId?: string): Promise<string> {
  const id = movementId ?? `mv_${shortId(12)}`;
  const counter = COUNTER_ACCOUNTS[kind];
  await db.query(
    'INSERT INTO ledger (movement_id, player_id, kind, run_id, wallet_amount, counter_account, counter_amount) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, playerId, kind, runId, amount, counter, -amount]
  );
  return id;
}

export interface LedgerMovement {
  movementId: string;
  kind: string;
  createdAt: string;
  runId: string | null;
  entries: { account: string; amount: number }[];
}

export async function movementsOf(db: Db, playerId: string): Promise<LedgerMovement[]> {
  const r = await db.query(
    'SELECT movement_id, kind, created_at, run_id, wallet_amount, counter_account, counter_amount FROM ledger WHERE player_id = $1 ORDER BY created_at DESC, movement_id DESC',
    [playerId]
  );
  return r.rows.map((row: { movement_id: string; kind: string; created_at: Date; run_id: string | null; wallet_amount: string | number; counter_account: string; counter_amount: string | number }) => ({
    movementId: row.movement_id,
    kind: row.kind,
    createdAt: row.created_at.toISOString(),
    runId: row.run_id,
    entries: [
      { account: `wallet:${playerId}`, amount: Number(row.wallet_amount) },
      { account: row.counter_account, amount: Number(row.counter_amount) }
    ]
  }));
}
