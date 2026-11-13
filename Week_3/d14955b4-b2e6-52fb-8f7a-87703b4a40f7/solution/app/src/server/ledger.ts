import { isCurrency } from '../shared/amount.js';
import type { Currency } from '../shared/amount.js';
import type { PurchaseBody, PurchaseStatus } from '../shared/types.js';

export interface EventRow {
  message_id: string;
  type: 'purchase.receipt' | 'purchase.refunded' | 'match.finished';
  verdict: 'accepted' | 'refused';
  receipt_id: string | null;
  refund_id: string | null;
  item: string | null;
  amount_minor: number | null;
  currency: string | null;
}

function purchaseStatus(amountMinor: number, refundedMinor: number): PurchaseStatus {
  if (refundedMinor === 0) return 'paid';
  return refundedMinor >= amountMinor ? 'refunded' : 'partly_refunded';
}

const refundApplies = (refund: EventRow, currency: string | null): boolean => refund.currency === currency;

export function derivePurchases(events: readonly EventRow[]): PurchaseBody[] {
  const accepted = events.filter((event) => event.verdict === 'accepted');
  const refunds = accepted.filter((event) => event.type === 'purchase.refunded');
  return accepted
    .filter((event) => event.type === 'purchase.receipt' && isCurrency(event.currency))
    .map((receipt) => {
      const amount = receipt.amount_minor as number;
      const refunded = refunds
        .filter((refund) => refund.receipt_id === receipt.receipt_id && refundApplies(refund, receipt.currency))
        .reduce((total, refund) => total + (refund.amount_minor as number), 0);
      const refundedMinor = Math.min(amount, refunded);
      return {
        receipt_id: receipt.receipt_id as string,
        item: receipt.item as string,
        amount_minor: amount,
        currency: receipt.currency as Currency,
        refunded_minor: refundedMinor,
        status: purchaseStatus(amount, refundedMinor),
      };
    });
}

export function refundApplied(refund: EventRow, purchases: readonly PurchaseBody[]): boolean | null {
  const purchase = purchases.find((candidate) => candidate.receipt_id === refund.receipt_id);
  if (!purchase) return null;
  return refundApplies(refund, purchase.currency);
}
