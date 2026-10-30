// Block strength (brief: Business rules → Block strength). Frames are integer tenths.
// The server is the authority; the browser reuses `averageTenths` only for the provisional roll.

import type { Tier } from "./api.js";

export interface Thresholds {
  reduced: number;
  standard: number;
  bonus: number;
}

/** Mean of the samples, rounded half up to one decimal; null with no samples. */
export function averageTenths(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  const total = samples.reduce((sum, value) => sum + value, 0);
  return Math.floor((2 * total + samples.length) / (2 * samples.length));
}

export function tierFor(average: number | null, thresholds: Thresholds): Tier | null {
  if (average === null) return null;
  if (average >= thresholds.bonus) return "bonus";
  if (average >= thresholds.standard) return "standard";
  if (average >= thresholds.reduced) return "reduced";
  return "none";
}

/** One sample per ten delivered hives, rounded up. */
export function samplesRequired(hivesDelivered: number): number {
  return Math.ceil(hivesDelivered / 10);
}

export function tenthsToNumber(tenths: number | null): number | null {
  return tenths === null ? null : tenths / 10;
}
