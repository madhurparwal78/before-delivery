import type { Queryable } from '../db/pool.js';
import { newId } from '../lib/codes.js';
import type { KillBillTransaction } from '../services/killbill.js';

export interface PaymentRecordInput {
  orderId?: string | null;
  invoiceId?: string | null;
  refundId?: string | null;
  transaction: KillBillTransaction;
}

/** Every Kill Bill transaction the app makes is recorded, which is what reconciliation compares. */
export async function recordPayment(
  db: Queryable,
  input: PaymentRecordInput,
): Promise<void> {
  await db.query(
    `INSERT INTO payment_records (id, order_id, invoice_id, refund_id, killbill_transaction_id,
       external_key, transaction_type, amount_cents, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      newId(),
      input.orderId ?? null,
      input.invoiceId ?? null,
      input.refundId ?? null,
      input.transaction.transactionId,
      input.transaction.transactionExternalKey,
      input.transaction.transactionType,
      input.transaction.amountCents,
      input.transaction.status,
    ],
  );
}
