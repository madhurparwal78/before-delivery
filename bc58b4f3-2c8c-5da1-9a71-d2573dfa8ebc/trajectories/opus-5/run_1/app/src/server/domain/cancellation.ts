import { lateCancellationFeeCents, rateInForce, serviceLineFor } from './charges.js';
import { businessMinutesBetween } from './time.js';
import type { AssignmentRecord, RateEntry } from './types.js';

/** 48 business hours. */
export const LATE_NOTICE_BUSINESS_MINUTES = 2880;

export interface CancellationDecision {
  feeApplies: boolean;
  businessMinutesNotice: number;
  feeCents: number;
}

export function hasEnoughNotice(startAt: Date, at: Date): boolean {
  return businessMinutesBetween(at, startAt) >= LATE_NOTICE_BUSINESS_MINUTES;
}

export function cancellationDecision(
  assignment: AssignmentRecord,
  rates: readonly RateEntry[],
  at: Date,
): CancellationDecision {
  const businessMinutesNotice = businessMinutesBetween(at, assignment.startAt);
  const feeApplies =
    assignment.status !== 'draft' && businessMinutesNotice < LATE_NOTICE_BUSINESS_MINUTES;
  const rate = rateInForce(rates, assignment.startAt, serviceLineFor(assignment.languageCode));
  return {
    feeApplies,
    businessMinutesNotice,
    feeCents: feeApplies
      ? lateCancellationFeeCents(assignment.seatCount, rate.hourlyRateCents)
      : 0,
  };
}
