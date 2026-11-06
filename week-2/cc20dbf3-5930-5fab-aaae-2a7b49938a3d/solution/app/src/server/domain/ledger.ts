// The deposit ledger: append-only entries for every deposit hold, release, damage charge, extra damage
// charge and late fee. Deposits held is derived from the entries, never stored.

import { randomUUID } from "node:crypto";
import type { LedgerEntry, LedgerKind, LedgerView } from "../../shared/api.js";
import { type Db, pool } from "../db.js";

/** The entry kinds that move a deposit; for a settled loan they net to zero. */
const DEPOSIT_KINDS: readonly LedgerKind[] = ["deposit_hold", "deposit_release", "damage_charge"];

export async function recordLedgerEntry(db: Db, loanId: string, kind: LedgerKind, amountCents: number, now: Date): Promise<void> {
  await db.query("INSERT INTO ledger_entry (id, loan_id, kind, amount_cents, created_at) VALUES ($1, $2, $3, $4, $5)", [
    randomUUID(),
    loanId,
    kind,
    amountCents,
    now,
  ]);
}

export async function ledgerView(loanId: string | null): Promise<LedgerView> {
  const entries = await pool.query<{ id: string; loan_id: string; item_id: string; item_name: string; kind: LedgerKind; amount_cents: number; created_at: Date }>(
    `SELECT e.id, e.loan_id, i.id AS item_id, i.name AS item_name, e.kind, e.amount_cents, e.created_at
     FROM ledger_entry e JOIN loan l ON l.id = e.loan_id JOIN item i ON i.id = l.item_id
     WHERE $1::text IS NULL OR e.loan_id::text = $1 ORDER BY e.created_at, e.seq`,
    [loanId],
  );
  const held = await pool.query<{ cents: number }>(
    "SELECT coalesce(sum(amount_cents), 0)::int AS cents FROM ledger_entry WHERE kind = ANY($1)",
    [DEPOSIT_KINDS],
  );
  return {
    entries: entries.rows.map(
      (row): LedgerEntry => ({
        id: row.id,
        loan_id: row.loan_id,
        item: { id: row.item_id, name: row.item_name },
        kind: row.kind,
        amount_cents: row.amount_cents,
        created_at: row.created_at.toISOString(),
      }),
    ),
    deposits_held_cents: held.rows[0]?.cents ?? 0,
  };
}
