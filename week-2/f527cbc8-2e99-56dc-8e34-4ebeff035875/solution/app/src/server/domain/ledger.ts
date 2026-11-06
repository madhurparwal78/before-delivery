// The append-only ledger and its mapping to dashboard figures (brief: Business rules, Ledger and dashboard).
import { now } from "../clock.js";
import type { Queryable } from "../db.js";

export type LedgerKind =
  | "billed"
  | "deposit_captured"
  | "invoice_payment"
  | "refund"
  | "deposit_transfer_out"
  | "deposit_transfer_in";

type Figure = "billed" | "collected" | "refunded";

/** Which dashboard figure each kind counts toward; the deposit transfer legs count toward none. */
export const FIGURE_OF: Record<LedgerKind, Figure | null> = {
  billed: "billed",
  deposit_captured: "collected",
  invoice_payment: "collected",
  refund: "refunded",
  deposit_transfer_out: null,
  deposit_transfer_in: null,
};

export interface LedgerEntry {
  /** Unique per fact, so recording the same fact twice writes one entry. */
  ref: string;
  kind: LedgerKind;
  amountCents: number;
  at?: Date;
  ownerId: string;
  horseId: string;
  businessDate: string;
}

export async function record(client: Queryable, entry: LedgerEntry): Promise<void> {
  await client.query(
    `INSERT INTO ledger_entries (ref, kind, amount_cents, at, owner_id, horse_id, business_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (ref) DO NOTHING`,
    [entry.ref, entry.kind, entry.amountCents, entry.at ?? new Date(now()), entry.ownerId, entry.horseId, entry.businessDate],
  );
}
