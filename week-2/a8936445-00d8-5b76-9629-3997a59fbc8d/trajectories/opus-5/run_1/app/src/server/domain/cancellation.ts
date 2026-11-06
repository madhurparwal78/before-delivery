import { percentOfCents, percentOfMinutes } from './money.js';
import type { BookingRecord, PolicyRecord } from './types.js';

export interface CancellationOutcome {
  late: boolean;
  /** Fee charged on account bookings. */
  feeCents: number;
  /** Minutes kept from the hour pack on hour-pack bookings. */
  feeMinutes: number;
  /** Minutes returned to the hour pack on hour-pack bookings. */
  returnedMinutes: number;
  /** Credit raised for account bookings. */
  creditCents: number;
}

export function cancellationOutcome(
  booking: BookingRecord,
  policy: PolicyRecord,
  at: Date,
): CancellationOutcome {
  const freeUntil = booking.startAt.getTime() - policy.freeWindowHours * 3_600_000;
  const late = at.getTime() > freeUntil;

  if (booking.payWith === 'hour_pack') {
    const debited = booking.elapsedMinutes;
    const feeMinutes = late ? percentOfMinutes(debited, policy.lateFeePercent) : 0;
    return {
      late,
      feeCents: 0,
      feeMinutes,
      returnedMinutes: debited - feeMinutes,
      creditCents: 0,
    };
  }

  const amount = booking.amountCents ?? 0;
  return {
    late,
    feeCents: late ? percentOfCents(amount, policy.lateFeePercent) : 0,
    feeMinutes: 0,
    returnedMinutes: 0,
    creditCents: amount,
  };
}
