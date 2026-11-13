export type RefundablePayment = {
  killbillPaymentId: string;
  amountMinor: bigint;
  refundedMinor: bigint;
  seq: bigint;
};

export type RefundPart = { killbillPaymentId: string; amountMinor: bigint };

/**
 * The refund allocation: newest confirmed payment first, taking no more from each than its
 * amount less what is already refunded from it.
 */
export const allocateRefund = (
  payments: readonly RefundablePayment[],
  refundMinor: bigint,
): RefundPart[] => {
  const parts: RefundPart[] = [];
  let remaining = refundMinor;
  const newestFirst = [...payments].sort((a, b) => (a.seq < b.seq ? 1 : a.seq > b.seq ? -1 : 0));
  for (const payment of newestFirst) {
    if (remaining <= 0n) break;
    const available = payment.amountMinor - payment.refundedMinor;
    if (available <= 0n) continue;
    const part = available < remaining ? available : remaining;
    parts.push({ killbillPaymentId: payment.killbillPaymentId, amountMinor: part });
    remaining -= part;
  }
  return parts;
};

export const refundTransactionKey = (engagementId: string, killbillPaymentId: string): string =>
  `${engagementId}:refund:${killbillPaymentId}`;
