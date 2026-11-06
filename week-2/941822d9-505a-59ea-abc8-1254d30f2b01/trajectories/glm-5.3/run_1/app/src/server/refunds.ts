import { splitShareCents } from "./money.ts";
import { config } from "./config.ts";

// The refund rule lives here and nowhere else.

export type RefundAmounts = { totalCents: number; employerCents: number; learnerCents: number };

export function refundAmounts(input: {
  listPriceCents: number;
  employerShareCents: number;
  totalMinutes: number;
  verifiedMinutes: number;
  enrolledAt: Date;
  approvalInstant: Date;
}): RefundAmounts {
  const windowMs = config.timings.fullRefundWindowSeconds * 1000;
  const withinWindow = input.approvalInstant.getTime() < input.enrolledAt.getTime() + windowMs;
  const belowQuarter = input.verifiedMinutes < input.totalMinutes / 4;
  const totalCents =
    withinWindow && belowQuarter
      ? input.listPriceCents
      : Math.floor((input.listPriceCents * (input.totalMinutes - input.verifiedMinutes)) / input.totalMinutes);
  const employerCents = splitShareCents(totalCents, input.employerShareCents, input.listPriceCents);
  return { totalCents, employerCents, learnerCents: totalCents - employerCents };
}
