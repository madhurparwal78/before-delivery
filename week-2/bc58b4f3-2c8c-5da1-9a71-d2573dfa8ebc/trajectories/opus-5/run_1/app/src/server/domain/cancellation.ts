import type { AssignmentStatus, CancellationQuote } from '../../shared/contract.js';
import { businessMinutesBetween, isLateNotice } from './businessMinutes.js';
import { MINIMUM_BILLABLE_MINUTES, seatAmountCents, type RateInForce } from './charges.js';

/**
 * The fee decision for cancelling an assignment at `now`. A draft never carries a fee;
 * anything already offered does when the notice falls below 48 business hours.
 */
export function cancellationDecision(args: {
  status: AssignmentStatus;
  seatCount: number;
  startAt: Date;
  now: Date;
  rate: RateInForce;
}): CancellationQuote {
  const businessMinutes = businessMinutesBetween(args.now, args.startAt);
  const feeApplies = args.status !== 'draft' && isLateNotice(businessMinutes);
  const feeCents = feeApplies
    ? args.seatCount * seatAmountCents(args.rate.hourly_rate_cents, MINIMUM_BILLABLE_MINUTES)
    : 0;
  return { fee_applies: feeApplies, business_minutes_notice: businessMinutes, fee_cents: feeCents };
}
