import { centralDateKey } from '../../shared/centralTime.js';
import type { AssignmentRecord, BillableKind, RateEntry, ServiceLine } from './types.js';

export const MINIMUM_BILLABLE_MINUTES = 120;
export const BILLING_INCREMENT_MINUTES = 15;
/** The first 20 miles each way are free, so 40 round-trip miles are free. */
const FREE_ROUND_TRIP_MILES = 40;

export interface ChargeLine {
  seat: number;
  actualMinutes: number | null;
  billableMinutes: number;
  amountCents: number;
  roundTripMiles: number;
  billableMiles: number;
  mileageCents: number;
}

export interface Charges {
  kind: BillableKind;
  rate: RateEntry;
  lines: ChargeLine[];
  totalCents: number;
}

export function serviceLineFor(languageCode: string): ServiceLine {
  return languageCode === 'asl' ? 'asl' : 'spoken';
}

/** The rate entry with the latest effective date on or before the appointment date. */
export function rateInForce(entries: readonly RateEntry[], startAt: Date, line: ServiceLine): RateEntry {
  const onDate = centralDateKey(startAt);
  const candidates = entries
    .filter((entry) => entry.serviceLine === line && entry.effectiveFrom <= onDate)
    .sort((left, right) => (left.effectiveFrom < right.effectiveFrom ? -1 : 1));
  const inForce = candidates[candidates.length - 1];
  if (inForce === undefined) {
    throw new Error(`No ${line} rate in force on ${onDate}`);
  }
  return inForce;
}

export function billableMinutes(actualMinutes: number | null): number {
  if (actualMinutes === null) return MINIMUM_BILLABLE_MINUTES;
  const rounded =
    Math.ceil(actualMinutes / BILLING_INCREMENT_MINUTES) * BILLING_INCREMENT_MINUTES;
  return Math.max(MINIMUM_BILLABLE_MINUTES, rounded);
}

/** hourly × minutes ÷ 60, rounded half-up to the cent, in integer arithmetic. */
export function seatAmountCents(hourlyRateCents: number, minutes: number): number {
  return Math.floor((hourlyRateCents * minutes * 2 + 60) / 120);
}

export function billableMiles(roundTripMiles: number): number {
  return Math.max(0, roundTripMiles - FREE_ROUND_TRIP_MILES);
}

export function lateCancellationFeeCents(seatCount: number, hourlyRateCents: number): number {
  return seatCount * seatAmountCents(hourlyRateCents, MINIMUM_BILLABLE_MINUTES);
}

/**
 * Verified work and fee-bearing cancellations are the only billable items. An
 * invoiced assignment stays billable so its charges can still be read back.
 */
export function isBillable(assignment: AssignmentRecord): boolean {
  if (assignment.status === 'cancelled') return assignment.cancelFeeApplies === true;
  return assignment.status === 'verified' || assignment.status === 'invoiced';
}

export function chargesFor(assignment: AssignmentRecord, rate: RateEntry): Charges {
  const kind: BillableKind = assignment.status === 'cancelled' ? 'late_cancellation' : 'service';
  const lines: ChargeLine[] = assignment.seats.map((seat) => {
    const actualMinutes = kind === 'late_cancellation' ? null : seat.actualMinutes;
    const minutes = billableMinutes(actualMinutes);
    const roundTripMiles = kind === 'late_cancellation' ? 0 : (seat.roundTripMiles ?? 0);
    const miles = billableMiles(roundTripMiles);
    return {
      seat: seat.seat,
      actualMinutes,
      billableMinutes: minutes,
      amountCents: seatAmountCents(rate.hourlyRateCents, minutes),
      roundTripMiles,
      billableMiles: miles,
      mileageCents: miles * rate.mileageCentsPerMile,
    };
  });
  const totalCents = lines.reduce((sum, line) => sum + line.amountCents + line.mileageCents, 0);
  return { kind, rate, lines, totalCents };
}
