/**
 * The change risk score and band, computed in one place from the published
 * formula and recomputed whenever a risk input changes.
 */

import type { RiskBand } from './priority';
import { intersectIntervals, type BusinessSchedule, openWindows } from './schedule';

export interface RiskInputs {
  readonly criticality: number;
  readonly peopleTotal: number;
  readonly peopleBand: number;
  readonly backoutTested: boolean;
  readonly inBusinessHours: boolean;
  readonly failedChanges90d: number;
  readonly durationHours: number;
}

/** 0 people is band 0, 1 to 10 is 1, 11 to 50 is 2, more than 50 is 3. */
export function peopleBandOf(peopleTotal: number): number {
  if (peopleTotal <= 0) return 0;
  if (peopleTotal <= 10) return 1;
  if (peopleTotal <= 50) return 2;
  return 3;
}

export function riskScore(inputs: RiskInputs): number {
  return (
    3 * inputs.criticality +
    2 * inputs.peopleBand +
    (inputs.backoutTested ? 0 : 4) +
    (inputs.inBusinessHours ? 2 : 0) +
    3 * Math.min(inputs.failedChanges90d, 2) +
    (inputs.durationHours > 4 ? 2 : 0)
  );
}

export function riskBand(score: number): RiskBand {
  if (score <= 9) return 'Low';
  if (score <= 17) return 'Moderate';
  return 'High';
}

/** True when the planned window overlaps open hours of the office hours schedule. */
export function overlapsOpenHours(
  schedule: BusinessSchedule,
  plannedStart: number,
  plannedEnd: number,
): boolean {
  if (plannedEnd <= plannedStart) return false;
  return (
    intersectIntervals(
      [{ start: plannedStart, end: plannedEnd }],
      openWindows(schedule, plannedStart, plannedEnd),
    ).length > 0
  );
}

export function durationHours(plannedStart: number, plannedEnd: number): number {
  return (plannedEnd - plannedStart) / 3_600_000;
}
