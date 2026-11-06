// The append-only ledger and its mapping to dashboard figures (brief: Business rules, Ledger and dashboard).
import { now } from "../clock.js";
/** Which dashboard figure each kind counts toward; the deposit transfer legs count toward none. */
export const FIGURE_OF = {
    billed: "billed",
    deposit_captured: "collected",
    invoice_payment: "collected",
    refund: "refunded",
    deposit_transfer_out: null,
    deposit_transfer_in: null,
};
export async function record(client, entry) {
    await client.query(`INSERT INTO ledger_entries (ref, kind, amount_cents, at, owner_id, horse_id, business_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (ref) DO NOTHING`, [entry.ref, entry.kind, entry.amountCents, entry.at ?? new Date(now()), entry.ownerId, entry.horseId, entry.businessDate]);
}
