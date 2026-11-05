import { newId } from '../db/ids.js';
import { pool, withTransaction } from '../db/pool.js';
import { refundWithItemAdjustment } from '../services/killbill.js';
import { splitRefundNewestFirst, type RefundablePayment } from './refundSchedule.js';

export interface SentRefund {
  readonly amountCents: number;
  readonly transactionExternalKeys: readonly string[];
}

interface SeatPaymentRow {
  payment_id: string;
  kb_payment_id: string;
  kb_invoice_item_id: string;
  amount_cents: number;
}

export function refundExternalKey(reservationId: string, n: number): string {
  return `ob-refund-${reservationId}-${n}`;
}

/**
 * Sends a cancelled seat's refund to Kill Bill, split across its payments
 * newest first, each part adjusting that seat's item on that payment's invoice.
 */
export async function sendRefund(
  reservationId: string,
  refundCents: number,
): Promise<SentRefund> {
  const payments = await pool.query<SeatPaymentRow>(
    `select item.payment_id, p.kb_payment_id, item.kb_invoice_item_id, item.amount_cents
     from payment_items item
     join payments p on p.id = item.payment_id
     where item.reservation_id = $1
     order by p.seq desc`,
    [reservationId],
  );
  const byId = new Map(payments.rows.map((row) => [row.payment_id, row]));
  const refundable: RefundablePayment[] = payments.rows.map((row) => ({
    paymentId: row.payment_id,
    seatAmountCents: row.amount_cents,
  }));

  const parts = splitRefundNewestFirst(refundable, refundCents);
  const keys: string[] = [];
  for (const part of parts) {
    const payment = byId.get(part.paymentId);
    if (payment === undefined) throw new Error('refund part lost its payment');
    const externalKey = refundExternalKey(reservationId, part.n);
    await refundWithItemAdjustment(
      payment.kb_payment_id,
      part.amountCents,
      externalKey,
      payment.kb_invoice_item_id,
    );
    keys.push(externalKey);
  }

  await withTransaction(async (client) => {
    for (const part of parts) {
      await client.query(
        `insert into refunds (id, reservation_id, payment_id, n, external_key, amount_cents)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (external_key) do nothing`,
        [
          newId('ref'),
          reservationId,
          part.paymentId,
          part.n,
          refundExternalKey(reservationId, part.n),
          part.amountCents,
        ],
      );
    }
    await client.query(`update reservations set state = 'refunded' where id = $1`, [reservationId]);
  });

  return {
    amountCents: parts.reduce((sum, part) => sum + part.amountCents, 0),
    transactionExternalKeys: keys,
  };
}
