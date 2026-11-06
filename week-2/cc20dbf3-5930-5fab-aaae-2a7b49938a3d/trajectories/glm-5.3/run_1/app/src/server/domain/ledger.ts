import { PoolClient } from "pg";
import { randomUuid } from "../config";

export type LedgerKind = "deposit_hold" | "deposit_release" | "damage_charge" | "extra_damage" | "late_fee";

export function insertLedgerEntry(
  client: PoolClient,
  values: { loanId: string; itemId: string; kind: LedgerKind; amountCents: number },
): void {
  client.query(
    "INSERT INTO ledger_entries (id, loan_id, item_id, kind, amount_cents) VALUES ($1, $2, $3, $4, $5)",
    [randomUuid(), values.loanId, values.itemId, values.kind, values.amountCents],
  );
}

export interface LedgerEntryRow {
  id: string;
  loan_id: string;
  item_id: string;
  item_name: string;
  kind: LedgerKind;
  amount_cents: number;
  created_at: Date;
}

export async function selectLedger(
  client: PoolClient,
  loanId?: string,
): Promise<{ entries: LedgerEntryRow[]; depositsHeldCents: number }> {
  const entriesResult = await client.query(
    `SELECT e.id::text AS id, e.loan_id::text AS loan_id, e.item_id, i.name AS item_name, e.kind, e.amount_cents, e.created_at
       FROM ledger_entries e JOIN items i ON i.id = e.item_id
       ${loanId === undefined ? "" : "WHERE e.loan_id = $1"}
       ORDER BY e.created_at ASC, e.id ASC`,
    loanId === undefined ? [] : [loanId],
  );
  const heldResult = await client.query(
    `SELECT COALESCE(SUM(amount_cents), 0)::int AS held
       FROM ledger_entries WHERE kind IN ('deposit_hold','deposit_release','damage_charge')`,
  );
  return {
    entries: entriesResult.rows as unknown as LedgerEntryRow[],
    depositsHeldCents: heldResult.rows[0].held as number,
  };
}
