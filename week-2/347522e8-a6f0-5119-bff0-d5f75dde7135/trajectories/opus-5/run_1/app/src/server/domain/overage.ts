/**
 * Overage at check-out: the minutes by which the recorded end passes the
 * booked end, in whole 15-minute units, charged at the booking's own rate.
 */

import { MINUTE_MS, SLOT_MINUTES } from '../../shared/kitchenTime.js';
import { overageUsd } from '../../shared/format.js';

export interface Overage {
  units: number;
  usd: string;
}

export function computeOverage(
  bookedEndMs: number,
  actualEndMs: number,
  overageUsdPerHour: string,
): Overage {
  const overMinutes = Math.max(0, (actualEndMs - bookedEndMs) / MINUTE_MS);
  const units = Math.ceil(overMinutes / SLOT_MINUTES);
  return { units, usd: overageUsd(units, overageUsdPerHour) };
}
