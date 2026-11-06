import { REFUND_FEE_CUTOFF_DATE, RESERVE_BY_DATE } from './venue.js';

const LATE_FEE_CENTS = 25000;

/**
 * The refund due for a seat, fixed by the venue-local date of the cancel request.
 * Returns null when the date falls outside every refund window.
 */
export function refundDueCents(cancelVenueDate: string, amountPaidCents: number): number | null {
  if (cancelVenueDate <= REFUND_FEE_CUTOFF_DATE) {
    return amountPaidCents - LATE_FEE_CENTS;
  }
  if (cancelVenueDate <= RESERVE_BY_DATE) {
    return Math.floor(amountPaidCents / 2);
  }
  return null;
}

export interface RefundablePayment {
  readonly paymentId: string;
  readonly seatAmountCents: number;
}

export interface RefundPart {
  readonly paymentId: string;
  readonly amountCents: number;
  readonly n: number;
}

/**
 * Splits a refund across a seat's payments, newest payment first. Each part is
 * no larger than what that payment paid for this seat.
 */
export function splitRefundNewestFirst(
  newestFirst: readonly RefundablePayment[],
  refundCents: number,
): RefundPart[] {
  const parts: RefundPart[] = [];
  let left = refundCents;
  let n = 1;
  for (const payment of newestFirst) {
    if (left <= 0) break;
    const amountCents = Math.min(left, payment.seatAmountCents);
    if (amountCents <= 0) continue;
    parts.push({ paymentId: payment.paymentId, amountCents, n });
    left -= amountCents;
    n += 1;
  }
  return parts;
}
