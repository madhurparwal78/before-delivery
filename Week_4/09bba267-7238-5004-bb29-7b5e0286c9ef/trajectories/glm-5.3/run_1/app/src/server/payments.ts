import type { PoolClient } from 'pg';
import type { KillBillClient } from './killbill';
import { exchangePaymentExternalKey, purchaseTransactionKey, refundTransactionKey } from './killbill';

export type OrderPaymentOutcome =
  | { outcome: 'confirmed'; paymentId: string }
  | { outcome: 'declined' }
  | { outcome: 'unavailable' };

export async function ensureKillBillAccount(
  killbill: KillBillClient,
  emailLower: string,
  name: string,
): Promise<string | null> {
  const accountId = await killbill.ensureAccount(emailLower, name);
  if (!accountId) return null;
  await killbill.ensurePaymentMethod(accountId, emailLower);
  return accountId;
}

export async function recordPurchase(
  client: PoolClient,
  killbill: KillBillClient,
  args: { orderId: string; accountId: string; totalCents: number },
): Promise<OrderPaymentOutcome> {
  const result = await killbill.purchase(
    args.accountId,
    args.orderId,
    purchaseTransactionKey(args.orderId),
    args.totalCents,
  );
  if (result.outcome === 'unreachable') return { outcome: 'unavailable' };
  if (result.outcome === 'declined') return { outcome: 'declined' };
  await client.query(
    `INSERT INTO killbill_payment_records (order_id, payment_id, payment_external_key, direction, amount_cents)
     VALUES ($1, $2, $3, 'purchase', $4)`,
    [args.orderId, result.paymentId, args.orderId, args.totalCents],
  );
  return { outcome: 'confirmed', paymentId: result.paymentId };
}

export async function recordExchangeTopUp(
  client: PoolClient,
  killbill: KillBillClient,
  args: { orderId: string; accountId: string; n: number; differenceCents: number },
): Promise<OrderPaymentOutcome> {
  const paymentExternalKey = exchangePaymentExternalKey(args.orderId, args.n);
  const result = await killbill.purchase(
    args.accountId,
    paymentExternalKey,
    purchaseTransactionKey(paymentExternalKey),
    args.differenceCents,
  );
  if (result.outcome === 'unreachable') return { outcome: 'unavailable' };
  if (result.outcome === 'declined') return { outcome: 'declined' };
  await client.query(
    `INSERT INTO killbill_payment_records (order_id, payment_id, payment_external_key, direction, amount_cents)
     VALUES ($1, $2, $3, 'purchase', $4)`,
    [args.orderId, result.paymentId, paymentExternalKey, args.differenceCents],
  );
  return { outcome: 'confirmed', paymentId: result.paymentId };
}

/**
 * Refunds against the order's payments, newest payment first, never more than
 * any payment still has refundable, totalling exactly the amount to refund.
 */
export async function refundThroughKillBill(
  client: PoolClient,
  killbill: KillBillClient,
  args: { orderId: string; accountId: string; amountCents: number },
): Promise<OrderPaymentOutcome> {
  const payments = await killbill.paymentsForAccount(args.accountId);
  const ours = payments.filter((p) => p.paymentExternalKey === args.orderId || p.paymentExternalKey.startsWith(`${args.orderId}-exchange-`));
  const ordered = [...ours].reverse();
  let remaining = args.amountCents;
  let refundsIssued = 0;
  for (const payment of ordered) {
    if (remaining === 0) break;
    const refundedCents = Math.round(payment.refundedAmount * 100);
    const purchasedCents = Math.round(payment.purchasedAmount * 100);
    const refundable = purchasedCents - refundedCents;
    if (refundable <= 0) continue;
    const take = Math.min(refundable, remaining);
    const n = refundsIssued + 1;
    const transactionKey = refundTransactionKey(payment.paymentExternalKey, n);
    const result = await killbill.refund(payment.paymentId, transactionKey, take);
    if (result.outcome === 'unreachable') return { outcome: 'unavailable' };
    if (result.outcome === 'declined') return { outcome: 'declined' };
    await client.query(
      `INSERT INTO killbill_payment_records (order_id, payment_id, payment_external_key, direction, amount_cents)
       VALUES ($1, $2, $3, 'refund', $4)`,
      [args.orderId, payment.paymentId, payment.paymentExternalKey, take],
    );
    remaining -= take;
    refundsIssued += 1;
  }
  if (remaining > 0) return { outcome: 'declined' };
  return { outcome: 'confirmed', paymentId: ordered[0]?.paymentId ?? '' };
}
