import type { App } from './app.ts';
import { issueReceiptArtifacts } from '../core/commerce.ts';
import { allocateReceiptNumber } from '../core/receipts.ts';

/** Settlement of a dunning retry: one order, one receipt, one PDF. */
export async function recordSettlementForDunning(
  app: App,
  input: {
    id: string;
    userId: string;
    userName: string;
    kind: string;
    description: string;
    currency: string;
    amountMinor: number;
    cardLast4: string;
    kbAccountId: string;
    kbInvoiceId: string;
    kbPaymentId: string;
    subject: string;
    tier: string;
  },
): Promise<string> {
  const conn = await app.pool.acquire();
  let receipt: string;
  try {
    await conn.query('BEGIN');
    receipt = await allocateReceiptNumber(conn);
    await conn.query(
      `INSERT INTO orders (id, receipt_number, kind, user_id, description, currency, amount_minor, refunded_minor,
         status, settled_at, card_last4, killbill_invoice_id, killbill_payment_id, killbill_account_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,'settled',now(),$8,$9,$10,$11)`,
      [
        input.id, receipt, input.kind, input.userId, input.description, input.currency, input.amountMinor,
        input.cardLast4, input.kbInvoiceId, input.kbPaymentId, input.kbAccountId,
      ],
    );
    await conn.query('COMMIT');
  } catch (e) {
    await conn.query('ROLLBACK');
    throw e;
  } finally {
    app.pool.release(conn);
  }

  const user = await app.pb.getUserById(input.userId);
  const order = {
    description: input.description,
    currency: input.currency,
    amount_minor: input.amountMinor,
    card_last4: input.cardLast4,
    settled_at: new Date(),
  };
  await issueReceiptArtifacts(app, {
    userName: input.userName,
    userEmail: user?.email ?? '',
    receipt,
    order,
    kind: input.kind === 'membership_upgrade' ? 'membership_upgrade' : 'membership_join',
    subject: input.subject.replace('{receipt}', receipt),
  });
  return receipt;
}
