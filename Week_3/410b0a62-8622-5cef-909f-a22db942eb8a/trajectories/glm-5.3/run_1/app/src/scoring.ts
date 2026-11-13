import { scoreRide, scoreRun } from './domain.js';

export { parseCsvFile, parseJsonFile, checkChannel, checkSampleCount } from './activity.js';

/** Normalised power (W) of a power sample series. */
export function normalisedPower(samples: readonly { power: number | null }[]): number {
  return scoreRide(samples.map((s) => s.power ?? 0), 1).np_w;
}

/** Normalised speed (m/s) of a speed sample series. */
export function normalisedSpeed(samples: readonly { speed: number | null }[]): number {
  return scoreRun(samples.map((s) => s.speed ?? 0), 1000).ns_mps;
}
