import type { ContractRate, Quote } from '../../shared/api.js';
import {
  agencyIso,
  agencyWallClock,
  firstInstantAtOrAfterWallClock,
  previousBusinessDay,
} from './time.js';
import { computeLineAmounts, type ContractTerms } from './billing.js';

/**
 * The free-cancellation cutoff is the start moved back two business days in the agency
 * zone, keeping the start's wall-clock time; a wall-clock time the cutoff date skips
 * resolves to the next instant that exists.
 */
export function lateCancellationCutoff(start: Date): Date {
  const wall = agencyWallClock(start);
  const startDate = `${String(wall.year).padStart(4, '0')}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
  const cutoffDate = previousBusinessDay(previousBusinessDay(startDate));
  const [year, month, day] = cutoffDate.split('-').map(Number) as [number, number, number];
  return firstInstantAtOrAfterWallClock({
    year,
    month,
    day,
    hour: wall.hour,
    minute: wall.minute,
  });
}

export interface QuoteInput {
  start: Date;
  durationMinutes: number;
  seatsHeld: number;
  rate: ContractRate;
  terms: ContractTerms;
  now: Date;
}

export function cancellationQuote(input: QuoteInput): Quote {
  const cutoff = lateCancellationCutoff(input.start);
  const late = input.now.getTime() > cutoff.getTime();
  const chargeable = late && input.seatsHeld > 0;
  const amounts = computeLineAmounts({
    rate: input.rate,
    terms: input.terms,
    basisMinutes: input.durationMinutes,
    interpreterCount: input.seatsHeld,
    mileageMiles: 0,
  });
  return {
    late,
    cutoff: agencyIso(cutoff),
    interpreter_count: input.seatsHeld,
    billable_minutes: amounts.billable_minutes,
    charge_cents: chargeable ? amounts.amount_cents : 0,
  };
}
