import { roundHalfUpDiv } from './decimal';

export const CONE_PENALTY_MS = 2_000;
export const MAX_CONES = 30;

export interface RunTimes {
  adjustedMs: number;
  indexedMs: number;
}

/** The one place the adjusted and indexed time formulas live. */
export function computeRunTimes(rawTimeMs: number, cones: number, factorTt: number): RunTimes {
  const adjustedMs = rawTimeMs + CONE_PENALTY_MS * cones;
  const indexedMs = roundHalfUpDiv(BigInt(adjustedMs) * BigInt(factorTt), 10_000n);
  return { adjustedMs, indexedMs };
}
