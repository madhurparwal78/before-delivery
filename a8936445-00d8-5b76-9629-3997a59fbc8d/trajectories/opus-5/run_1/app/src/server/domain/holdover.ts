import { HOLDOVER_GRACE_MINUTES, HOLDOVER_ROUNDING_MINUTES } from './constants.js';
import { stationTimeCents } from './money.js';

export interface HoldoverOutcome {
  reportedMinutes: number;
  billedMinutes: number;
  amountCents: number;
}

export function holdoverFor(reportedMinutes: number, hourlyRateCents: number): HoldoverOutcome {
  const billedMinutes =
    reportedMinutes <= HOLDOVER_GRACE_MINUTES
      ? 0
      : Math.ceil(reportedMinutes / HOLDOVER_ROUNDING_MINUTES) * HOLDOVER_ROUNDING_MINUTES;
  return {
    reportedMinutes,
    billedMinutes,
    amountCents: stationTimeCents(billedMinutes, hourlyRateCents),
  };
}
