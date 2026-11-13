/**
 * The till's arithmetic and the refund window. The share, commission and VAT split and
 * the refund window are each decided here alone.
 */

import { addDays, brusselsDate, brusselsInstant } from '../../shared/brussels.js';
import { divideHalfUp } from '../../shared/money.js';

const HIGHER_SHARE_ABOVE_CENTS = 30_000;
const LOWER_SHARE_PERCENT = 60;
const HIGHER_SHARE_PERCENT = 70;
const VAT_NUMERATOR = 21;
const VAT_DENOMINATOR = 121;
const REFUND_WINDOW_DAYS = 14;

export interface SaleSplit {
  priceCents: number;
  consignorShareCents: number;
  commissionCents: number;
  vatCents: number;
}

/**
 * The consignor's share is 60% of the whole sale price up to EUR 300.00 and 70% above it;
 * the commission is the rest, and the VAT inside the commission is commission × 21 / 121.
 */
export function splitSale(priceCents: number): SaleSplit {
  const percent =
    priceCents <= HIGHER_SHARE_ABOVE_CENTS ? LOWER_SHARE_PERCENT : HIGHER_SHARE_PERCENT;
  const consignorShareCents = divideHalfUp(priceCents * percent, 100);
  const commissionCents = priceCents - consignorShareCents;
  const vatCents = divideHalfUp(commissionCents * VAT_NUMERATOR, VAT_DENOMINATOR);
  return { priceCents, consignorShareCents, commissionCents, vatCents };
}

/**
 * A sale can be refunded until 23:59:59 Brussels on the 14th Brussels day after its date.
 * A sale on 14 Mar 2027 is refundable until 2027-03-28T21:59:59Z.
 */
export function refundableUntil(soldAt: number): number {
  const lastDay = addDays(brusselsDate(soldAt), REFUND_WINDOW_DAYS);
  return brusselsInstant(lastDay, 23, 59, 59);
}

export function isRefundable(soldAt: number, now: number): boolean {
  return now <= refundableUntil(soldAt);
}
