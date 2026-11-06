import { connectDb, type Tx } from './db.js';
import { now } from './time.js';

/** Append-only ledger (DP-79, DP-80). */
export type LedgerKind = 'billed' | 'deposit_captured' | 'invoice_payment' | 'refund' | 'deposit_transfer_out' | 'deposit_transfer_in';

export async function ledgerEntry(tx: Tx, kind: LedgerKind, amountCents: number, at: Date, ownerId: string, horseId: string | null, businessDate: string, invoiceId: string | null, paymentId: string | null): Promise<void> {
  await tx.query(
    `insert into ledger(kind, amount_cents, at, owner_id, horse_id, business_date, invoice_id, payment_id)
     values($1,$2,$3,$4,$5,$6,$7,$8)`,
    [kind, amountCents, at, ownerId, horseId, businessDate, invoiceId, paymentId]
  );
}
