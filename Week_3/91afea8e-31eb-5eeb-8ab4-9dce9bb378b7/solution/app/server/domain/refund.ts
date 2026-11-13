import { roundHalfUp } from "./money.js";

/** k of q units of an amount: the prorated share, or the exact remainder when k covers the last units left. */
export function prorate(amountPaise: number, quantity: number, units: number, unitsLeft: number, alreadyTakenPaise: number): number {
  return units === unitsLeft ? amountPaise - alreadyTakenPaise : roundHalfUp(amountPaise * units, quantity);
}

/** Refunding k of a line's q units returns its prorated share of the line total (coupon and tax included). */
export function proratedRefund(lineTotalPaise: number, quantity: number, unitsSettled: number, refundedPaise: number, units: number): number {
  return prorate(lineTotalPaise, quantity, units, quantity - unitsSettled, refundedPaise);
}
