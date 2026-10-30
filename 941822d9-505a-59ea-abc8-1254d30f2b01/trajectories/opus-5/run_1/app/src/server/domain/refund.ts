import { floorShare } from './money.js';

/** The refund amount and its split between hospital and nurse are decided only here. */

export interface RefundAmounts {
  readonly refundTotalCents: number;
  readonly employerRefundCents: number;
  readonly learnerRefundCents: number;
}

export interface RefundInput {
  readonly listPriceCents: number;
  readonly employerShareCents: number;
  readonly totalMinutes: number;
  readonly verifiedMinutes: number;
  readonly enrolledAt: Date;
  readonly at: Date;
  readonly fullRefundWindowSeconds: number;
}

const FULL_REFUND_PROGRESS_LIMIT_PERCENT = 25;

function withinFullRefundWindow(input: RefundInput): boolean {
  const windowEnds = input.enrolledAt.getTime() + input.fullRefundWindowSeconds * 1000;
  return input.at.getTime() < windowEnds;
}

function barelyStarted(input: RefundInput): boolean {
  return input.verifiedMinutes * 100 < FULL_REFUND_PROGRESS_LIMIT_PERCENT * input.totalMinutes;
}

export function computeRefund(input: RefundInput): RefundAmounts {
  const refundTotalCents =
    withinFullRefundWindow(input) && barelyStarted(input)
      ? input.listPriceCents
      : floorShare(input.listPriceCents, input.totalMinutes - input.verifiedMinutes, input.totalMinutes);
  const employerRefundCents = floorShare(refundTotalCents, input.employerShareCents, input.listPriceCents);
  return {
    refundTotalCents,
    employerRefundCents,
    learnerRefundCents: refundTotalCents - employerRefundCents,
  };
}
