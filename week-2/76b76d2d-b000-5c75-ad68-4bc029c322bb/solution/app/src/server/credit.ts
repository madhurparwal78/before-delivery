import type pg from "pg";
import { randomUUID } from "node:crypto";
import { one, query, type Db } from "./db.ts";
import { isoToronto } from "./time.ts";

type MovementKind = "goodwill" | "spend" | "reversal";

/** The two rows of each movement: the member's side, then the counter account (brief: Paired credit ledger). */
const PAIRS: Record<MovementKind, [number, string]> = {
  goodwill: [1, "goodwill-expense"],
  spend: [-1, "credit-redeemed"],
  reversal: [1, "credit-redeemed"],
};

/** Writes one movement as two rows sharing a movement id, summing to zero. */
export async function recordMovement(tx: pg.PoolClient, accountNumber: string, kind: MovementKind, cents: number, reference: string): Promise<string> {
  const movementId = randomUUID();
  const [sign, counter] = PAIRS[kind];
  await tx.query(
    `INSERT INTO credit_ledger (movement_id, account_number, ledger_account, amount_cents, kind, reference)
     VALUES ($1, $2, 'member-credit', $3, $4, $5), ($1, $2, $6, $7, $4, $5)`,
    [movementId, accountNumber, sign * cents, kind, reference, counter, -sign * cents],
  );
  return movementId;
}

/** An account's balance is the sum of its `member-credit` rows. */
export async function creditBalance(accountNumber: string | null, db?: Db): Promise<number> {
  if (!accountNumber) return 0;
  const row = await one<{ balance: number }>(
    "SELECT COALESCE(sum(amount_cents), 0)::int AS balance FROM credit_ledger WHERE account_number = $1 AND ledger_account = 'member-credit'",
    [accountNumber], db,
  );
  return row?.balance ?? 0;
}

export async function creditMovements(accountNumber: string): Promise<Record<string, unknown>[]> {
  const rows = await query<{ movement_id: string; kind: string; amount_cents: number; reference: string; created_at: Date }>(
    "SELECT movement_id, kind, amount_cents, reference, created_at FROM credit_ledger WHERE account_number = $1 AND ledger_account = 'member-credit' ORDER BY id DESC",
    [accountNumber],
  );
  return rows.map((row) => ({ id: row.movement_id, kind: row.kind, amount_cents: row.amount_cents, reference: row.reference, at: isoToronto(row.created_at) }));
}
