import { randomUUID } from 'node:crypto';
import type { Queryable } from './db.js';
import { one } from './db.js';
import { pushToPlayer } from './pushes.js';

export type MovementKind = 'opening' | 'pickups' | 'result' | 'upgrade' | 'car' | 'refit' | 'finals';

export const COUNTER_ACCOUNTS: Record<MovementKind, string> = {
  opening: 'house:grants',
  finals: 'house:grants',
  pickups: 'house:pickups',
  result: 'house:results',
  upgrade: 'house:shop',
  car: 'house:shop',
  refit: 'house:refits',
};

export function walletAccount(playerId: string): string {
  return `wallet:${playerId}`;
}

/** The balance is always the sum of the player's wallet entries. */
export async function balanceOf(tx: Queryable, playerId: string): Promise<number> {
  const row = await one<{ balance: string }>(
    tx,
    'select coalesce(sum(amount), 0)::text as balance from ledger_entries where account = $1',
    [walletAccount(playerId)],
  );
  return Number.parseInt(row?.balance ?? '0', 10);
}

export interface MovementInput {
  playerId: string;
  kind: MovementKind;
  amount: number;
  runId?: string | null;
  purchaseId?: string | null;
}

/** Writes one movement as two entries that sum to zero and pushes the new balance. */
export async function writeMovement(
  tx: Queryable,
  input: MovementInput,
): Promise<{ movementId: string; balance: number }> {
  const movementId = randomUUID();
  await tx.query(
    'insert into ledger_movements (movement_id, player_id, kind, run_id) values ($1, $2, $3, $4)',
    [movementId, input.playerId, input.kind, input.runId ?? null],
  );
  await tx.query(
    'insert into ledger_entries (movement_id, account, amount) values ($1, $2, $3), ($1, $4, $5)',
    [
      movementId,
      walletAccount(input.playerId),
      input.amount,
      COUNTER_ACCOUNTS[input.kind],
      -input.amount,
    ],
  );
  const balance = await balanceOf(tx, input.playerId);
  pushToPlayer(input.playerId, {
    type: 'balance',
    balance,
    movementId,
    purchaseId: input.purchaseId ?? null,
  });
  return { movementId, balance };
}

export interface MovementBody {
  movementId: string;
  kind: string;
  createdAt: string;
  runId: string | null;
  entries: { account: string; amount: number }[];
}

export async function ledgerBody(
  tx: Queryable,
  playerId: string,
): Promise<{ balance: number; total: number; movements: MovementBody[] }> {
  const { rows } = await tx.query<{
    movement_id: string;
    kind: string;
    created_at: Date;
    run_id: string | null;
    account: string;
    amount: string;
  }>(
    `select m.movement_id, m.kind, m.created_at, m.run_id, e.account, e.amount::text as amount
     from ledger_movements m
     join ledger_entries e on e.movement_id = m.movement_id
     where m.player_id = $1
     order by m.seq desc, e.entry_id asc`,
    [playerId],
  );
  const movements: MovementBody[] = [];
  const index = new Map<string, MovementBody>();
  for (const row of rows) {
    let movement = index.get(row.movement_id);
    if (!movement) {
      movement = {
        movementId: row.movement_id,
        kind: row.kind,
        createdAt: row.created_at.toISOString(),
        runId: row.run_id,
        entries: [],
      };
      index.set(row.movement_id, movement);
      movements.push(movement);
    }
    movement.entries.push({ account: row.account, amount: Number.parseInt(row.amount, 10) });
  }
  const balance = await balanceOf(tx, playerId);
  return { balance, total: balance, movements };
}
