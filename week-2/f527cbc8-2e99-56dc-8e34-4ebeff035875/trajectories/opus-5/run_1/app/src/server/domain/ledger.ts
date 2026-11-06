import { query, type Db } from '../db.js';
import { newId } from '../util.js';

/**
 * The append-only ledger and its one mapping to the dashboard's figures. A correction
 * is a new entry, never an edit.
 */
export type LedgerKind =
  | 'billed'
  | 'deposit_captured'
  | 'invoice_payment'
  | 'refund'
  | 'deposit_transfer_out'
  | 'deposit_transfer_in';

export type DashboardFigure = 'billed' | 'collected' | 'refunded' | 'none';

/** Applied deposits count as neither new money nor refunds. */
export const FIGURE_OF: Record<LedgerKind, DashboardFigure> = {
  billed: 'billed',
  deposit_captured: 'collected',
  invoice_payment: 'collected',
  refund: 'refunded',
  deposit_transfer_out: 'none',
  deposit_transfer_in: 'none',
};

export interface LedgerWrite {
  kind: LedgerKind;
  amountCents: number;
  at: Date;
  ownerId: string;
  horseId: string;
  businessDate: string;
  invoiceId?: string | null;
  paymentId?: string | null;
  refundId?: string | null;
}

export async function writeLedger(db: Db, entry: LedgerWrite): Promise<void> {
  await query(
    db,
    `INSERT INTO ledger_entries (id, kind, amount_cents, at, owner_id, horse_id, business_date,
                                 invoice_id, payment_id, refund_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$4)`,
    [
      newId(),
      entry.kind,
      entry.amountCents,
      entry.at,
      entry.ownerId,
      entry.horseId,
      entry.businessDate,
      entry.invoiceId ?? null,
      entry.paymentId ?? null,
      entry.refundId ?? null,
    ],
  );
}

export async function hasLedgerEntry(
  db: Db,
  kind: LedgerKind,
  columns: { paymentId?: string; invoiceId?: string; refundId?: string },
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    db,
    `SELECT id FROM ledger_entries
     WHERE kind = $1
       AND ($2::text IS NULL OR payment_id = $2)
       AND ($3::text IS NULL OR invoice_id = $3)
       AND ($4::text IS NULL OR refund_id = $4)
     LIMIT 1`,
    [kind, columns.paymentId ?? null, columns.invoiceId ?? null, columns.refundId ?? null],
  );
  return rows.length > 0;
}
