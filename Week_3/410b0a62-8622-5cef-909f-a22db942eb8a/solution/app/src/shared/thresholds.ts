import type { Sport, Threshold, ThresholdKind } from './types.js';

export const thresholdKindFor = (sport: Sport): ThresholdKind => (sport === 'bike' ? 'ftp' : 'pace');
export const sportOf = (kind: ThresholdKind): Sport => (kind === 'ftp' ? 'bike' : 'run');

/** Seconds per kilometre to metres per second, and back. */
export const speedOfPace = (secondsPerKm: number): number => 1000 / secondsPerKm;
export const paceOfSpeed = (metresPerSecond: number): number => 1000 / metresPerSecond;

/** The latest entry of its kind whose effective-from date is on or before the day. */
export function thresholdInForce(history: readonly Threshold[], kind: ThresholdKind, date: string): Threshold | null {
  let found: Threshold | null = null;
  for (const entry of history) {
    if (entry.kind === kind && entry.effective_from <= date && (!found || entry.effective_from > found.effective_from)) {
      found = entry;
    }
  }
  return found;
}

/** The measure a session is scored against: watts for a bike, metres per second for a run. */
const thresholdBasis = (sport: Sport, threshold: Threshold): number =>
  sport === 'bike' ? threshold.value : speedOfPace(threshold.value);

/** Intensity factor and training stress of a session of the given duration at a measured power or speed. */
export function scoreSession(sport: Sport, durationS: number, measure: number, threshold: Threshold): { if: number; tss: number } {
  const intensity = measure / thresholdBasis(sport, threshold);
  return { if: intensity, tss: (durationS / 3600) * intensity ** 2 * 100 };
}
