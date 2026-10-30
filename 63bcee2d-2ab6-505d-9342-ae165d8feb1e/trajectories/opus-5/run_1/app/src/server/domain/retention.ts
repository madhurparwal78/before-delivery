/**
 * Retention: 10% of each period's valuation held until 5% of the contract sum
 * is held, half released at practical completion and the rest after the defects
 * period ends. Each of the three rounded values is rounded once, half-up.
 */

import { halfOfCents, percentOfCents } from './money.js';

const RETENTION_RATE_PERCENT = '10';
const RETENTION_CAP_PERCENT = '5';

export function retentionCapCents(contractSumCents: number): number {
  return percentOfCents(contractSumCents, RETENTION_CAP_PERCENT);
}

export interface InterimFigures {
  valuationThisPeriodCents: number;
  retentionThisPeriodCents: number;
  retentionHeldCents: number;
  amountDueCents: number;
}

export function interimCertificate(options: {
  grossValuationCents: number;
  previousGrossValuationCents: number;
  retentionHeldCents: number;
  contractSumCents: number;
  practicalCompletionRecorded: boolean;
}): InterimFigures {
  const valuationThisPeriodCents =
    options.grossValuationCents - options.previousGrossValuationCents;
  const headroom = retentionCapCents(options.contractSumCents) - options.retentionHeldCents;
  const retentionThisPeriodCents = options.practicalCompletionRecorded
    ? 0
    : Math.max(0, Math.min(percentOfCents(valuationThisPeriodCents, RETENTION_RATE_PERCENT), headroom));
  return {
    valuationThisPeriodCents,
    retentionThisPeriodCents,
    retentionHeldCents: options.retentionHeldCents + retentionThisPeriodCents,
    amountDueCents: valuationThisPeriodCents - retentionThisPeriodCents,
  };
}

export function halfReleaseCents(retentionHeldCents: number): number {
  return halfOfCents(retentionHeldCents);
}
