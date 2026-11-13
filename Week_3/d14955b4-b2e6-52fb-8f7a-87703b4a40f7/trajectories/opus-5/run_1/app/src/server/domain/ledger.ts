import type { Purchase, PurchaseStatus } from '../../shared/types';

/** The one place the refund ledger and purchase status are decided. */

export interface PurchaseRecord {
  receipt_id: string;
  item: string;
  amount_minor: number;
  currency: string;
}

export interface RefundRecord {
  refund_id: string;
  receipt_id: string;
  amount_minor: number;
  currency: string;
}

export function refundedMinor(purchase: PurchaseRecord, refunds: readonly RefundRecord[]): number {
  if (purchase.amount_minor === 0) return 0;
  const sum = refunds
    .filter((refund) => refund.receipt_id === purchase.receipt_id && refund.currency === purchase.currency)
    .reduce((total, refund) => total + refund.amount_minor, 0);
  return Math.min(purchase.amount_minor, sum);
}

export function purchaseStatus(amountMinor: number, refunded: number): PurchaseStatus {
  if (refunded === 0) return 'paid';
  if (refunded < amountMinor) return 'partly_refunded';
  return 'refunded';
}

export function buildPurchase(purchase: PurchaseRecord, refunds: readonly RefundRecord[]): Purchase {
  const refunded = refundedMinor(purchase, refunds);
  return {
    receipt_id: purchase.receipt_id,
    item: purchase.item,
    amount_minor: purchase.amount_minor,
    currency: purchase.currency,
    refunded_minor: refunded,
    status: purchaseStatus(purchase.amount_minor, refunded),
  };
}

/**
 * `refund_applied` is null while no purchase exists for the receipt, true when
 * the purchase is in the refund's currency, and false when it is in another.
 */
export function refundApplied(
  purchase: PurchaseRecord | undefined,
  refundCurrency: string,
): boolean | null {
  if (!purchase) return null;
  return purchase.currency === refundCurrency;
}
