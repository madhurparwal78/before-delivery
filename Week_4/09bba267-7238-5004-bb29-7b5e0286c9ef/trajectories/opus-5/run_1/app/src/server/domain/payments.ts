import { first, withTransaction } from '../db';
import { recordPurchase, recordRefund } from '../services/killbill';
import { nextExchangeChargeNumber, recordPaymentTransaction, refundablePayments, setKillbillAccount } from './orders';

export type SettlementResult = 'confirmed' | 'declined' | 'unavailable';

/** Charges an extra amount against an order as its own Kill Bill payment. */
export async function chargeExtra(input: {
  readonly orderId: string;
  readonly email: string;
  readonly name: string;
  readonly amountCents: number;
}): Promise<SettlementResult> {
  const chargeNumber = await withTransaction((db) => nextExchangeChargeNumber(db, input.orderId));
  const paymentExternalKey = `${input.orderId}-exchange-${chargeNumber}`;
  const outcome = await recordPurchase({
    email: input.email,
    name: input.name,
    paymentExternalKey,
    transactionExternalKey: `${paymentExternalKey}-purchase`,
    amountCents: input.amountCents,
  });
  if (outcome.kind !== 'confirmed') return outcome.kind === 'declined' ? 'declined' : 'unavailable';
  await withTransaction(async (db) => {
    await recordPaymentTransaction(db, {
      orderId: input.orderId,
      kind: 'purchase',
      paymentExternalKey,
      killbillPaymentId: outcome.killbillPaymentId,
      amountCents: input.amountCents,
    });
    await setKillbillAccount(db, input.orderId, outcome.killbillAccountId);
  });
  return 'confirmed';
}

/**
 * Gives an amount back through Kill Bill refund transactions against the order's payments,
 * newest payment first, never more than a payment still has refundable.
 */
export async function giveBack(input: {
  readonly orderId: string;
  readonly amountCents: number;
}): Promise<SettlementResult> {
  const payments = await withTransaction((db) => refundablePayments(db, input.orderId));
  const started = await withTransaction((db) =>
    first<{ count: string }>(
      db,
      `select count(*) as count from payment_transactions where order_id = $1 and kind = 'refund'`,
      [input.orderId],
    ),
  );
  let sequence = Number(started?.count ?? 0);
  let outstanding = input.amountCents;
  for (const payment of payments) {
    if (outstanding === 0) break;
    const part = Math.min(outstanding, payment.refundableCents);
    if (part <= 0) continue;
    sequence += 1;
    const transactionExternalKey = `${input.orderId}-refund-${sequence}`;
    const outcome = await recordRefund({
      killbillPaymentId: payment.killbillPaymentId,
      transactionExternalKey,
      amountCents: part,
    });
    if (outcome.kind !== 'confirmed') return outcome.kind === 'declined' ? 'declined' : 'unavailable';
    await withTransaction((db) =>
      recordPaymentTransaction(db, {
        orderId: input.orderId,
        kind: 'refund',
        paymentExternalKey: payment.paymentExternalKey,
        killbillPaymentId: payment.killbillPaymentId,
        amountCents: part,
      }),
    );
    outstanding -= part;
  }
  return outstanding === 0 ? 'confirmed' : 'unavailable';
}
