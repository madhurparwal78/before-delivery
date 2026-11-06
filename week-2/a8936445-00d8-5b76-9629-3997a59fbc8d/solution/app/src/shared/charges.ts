// Cancellation charges and fee refunds (brief: Cancellation charges). The server applies them; the browser
// uses the same definitions to state what a cancellation would keep before the user confirms it.
import type { PayWith } from "./kitchen";

/** Rounds num/den half up to a whole unit (num and den non-negative). */
export function roundHalfUp(num: number, den: number): number {
  return Math.floor((2 * num + den) / (2 * den));
}

export interface CancellationCharge {
  late: boolean;
  creditCents: number;
  feeCents: number;
  feeMinutes: number;
  returnMinutes: number;
}

/** Free at or before start minus the free window; otherwise late, charged by the booking's own policy version. */
export function cancellationCharge(
  booking: { startMs: number; payWith: PayWith; amountCents: number; elapsedMinutes: number },
  policy: { free_window_hours: number; late_fee_percent: number },
  nowMs: number,
): CancellationCharge {
  const late = nowMs > booking.startMs - policy.free_window_hours * 3_600_000;
  if (booking.payWith === "account") {
    const feeCents = late ? roundHalfUp(booking.amountCents * policy.late_fee_percent, 100) : 0;
    return { late, creditCents: booking.amountCents, feeCents, feeMinutes: 0, returnMinutes: 0 };
  }
  const feeMinutes = late ? roundHalfUp(booking.elapsedMinutes * policy.late_fee_percent, 100) : 0;
  return { late, creditCents: 0, feeCents: 0, feeMinutes, returnMinutes: booking.elapsedMinutes - feeMinutes };
}

/** A late fee above zero may be refunded once (whether it is already invoiced is the server's to check). */
export function feeRefundable(booking: { cancelled: boolean; feeCents: number; feeMinutes: number; refunded: boolean }): boolean {
  return booking.cancelled && booking.feeCents + booking.feeMinutes > 0 && !booking.refunded;
}
