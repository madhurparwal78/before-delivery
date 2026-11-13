import { divideHalfUp, formatDollars, type Cents } from './money.js';

export const MINIMUM_BILLABLE_MINUTES = 120;
const INCREMENT_MINUTES = 15;

/** Billable minutes: the larger of the two-hour minimum and the time rounded up to a quarter hour. */
export function billableMinutes(minutes: number): number {
  const rounded = Math.ceil(minutes / INCREMENT_MINUTES) * INCREMENT_MINUTES;
  return Math.max(MINIMUM_BILLABLE_MINUTES, rounded);
}

export interface Charge {
  billable_minutes: number;
  seats: number;
  hourly_rate: string;
  amount: string;
}

/**
 * The one charge rule: billable minutes x hourly rate x seats / 60, rounded half up
 * to the cent on the final amount only.
 */
export function computeCharge(minutes: number, seats: number, hourlyRate: Cents): Charge {
  const billable = billableMinutes(minutes);
  const amount =
    seats === 0 ? 0n : divideHalfUp(BigInt(billable) * hourlyRate * BigInt(seats), 60n);
  return {
    billable_minutes: billable,
    seats,
    hourly_rate: formatDollars(hourlyRate),
    amount: formatDollars(amount),
  };
}
