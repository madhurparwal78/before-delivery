import { randomUUID } from 'node:crypto';
import { one, query, type Tx } from '../db/pool.ts';
import { toIso } from '../domain/time.ts';

export type MovementKind = 'goodwill' | 'spend' | 'reversal';

const PAIRS: Record<MovementKind, { counterpart: string; sign: 1 | -1 }> = {
  goodwill: { counterpart: 'goodwill-expense', sign: 1 },
  spend: { counterpart: 'credit-redeemed', sign: -1 },
  reversal: { counterpart: 'credit-redeemed', sign: 1 },
};

/** Writes the paired ledger movement: member-credit and its counterpart always sum to zero. */
export async function writeMovement(
  tx: Tx,
  input: { accountNumber: string; kind: MovementKind; amountCents: number; reference: string },
): Promise<string> {
  const movementId = randomUUID();
  const { counterpart, sign } = PAIRS[input.kind];
  const signed = sign * input.amountCents;
  await tx.query(
    `insert into credit_ledger(movement_id, account_number, ledger_account, amount_cents, kind, reference)
       values($1,$2,'member-credit',$3,$4,$5), ($1,$2,$6,$7,$4,$5)`,
    [movementId, input.accountNumber, signed, input.kind, input.reference, counterpart, -signed],
  );
  return movementId;
}

export async function creditBalance(accountNumber: string | null): Promise<number> {
  if (accountNumber === null) return 0;
  const row = await one<{ balance: number }>(
    `select coalesce(sum(amount_cents), 0)::int as balance from credit_ledger
       where account_number = $1 and ledger_account = 'member-credit'`,
    [accountNumber],
  );
  return row?.balance ?? 0;
}

export type Movement = {
  id: string;
  kind: MovementKind;
  amount_cents: number;
  reference: string;
  at: string;
};

export async function creditMovements(accountNumber: string | null): Promise<Movement[]> {
  if (accountNumber === null) return [];
  const rows = await query<{
    movement_id: string;
    kind: MovementKind;
    amount_cents: number;
    reference: string;
    created_at: Date;
  }>(
    `select movement_id::text as movement_id, kind, amount_cents, reference, created_at
       from credit_ledger where account_number = $1 and ledger_account = 'member-credit'
      order by id desc`,
    [accountNumber],
  );
  return rows.map((row) => ({
    id: row.movement_id,
    kind: row.kind,
    amount_cents: row.amount_cents,
    reference: row.reference,
    at: toIso(row.created_at),
  }));
}
