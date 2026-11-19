import { daysBetween, localDateKey, type DateKey } from './time.js';
import { NIGHTS_PER_COHORT } from './night.js';

export type CohortPhase = 'draft' | 'enrolling' | 'baseline' | 'technique' | 'closed';

export interface CohortTiming {
  readonly startsOn: DateKey;
  readonly publishedAt: Date | null;
  readonly closedAt: Date | null;
  readonly coachTz: string;
}

export interface CohortStanding {
  readonly phase: CohortPhase;
  readonly week: number | null;
}

const BASELINE_NIGHTS = 7;

export function cohortStanding(timing: CohortTiming, now: Date): CohortStanding {
  if (timing.publishedAt === null) return { phase: 'draft', week: null };
  if (timing.closedAt !== null) return { phase: 'closed', week: null };
  const today = localDateKey(now, timing.coachTz);
  const elapsed = daysBetween(timing.startsOn, today);
  if (elapsed < 0) return { phase: 'enrolling', week: null };
  if (elapsed >= NIGHTS_PER_COHORT) return { phase: 'closed', week: null };
  const week = Math.floor(elapsed / 7) + 1;
  return { phase: elapsed < BASELINE_NIGHTS ? 'baseline' : 'technique', week };
}

export function enrollmentOpen(phase: CohortPhase): boolean {
  return phase === 'enrolling' || phase === 'baseline';
}

export function cohortRunning(phase: CohortPhase): boolean {
  return phase === 'baseline' || phase === 'technique';
}

export function refundWindowOpen(phase: CohortPhase): boolean {
  return phase === 'enrolling' || phase === 'baseline';
}

export function publishAllowed(phase: CohortPhase): boolean {
  return phase === 'draft';
}

export function closeAllowed(phase: CohortPhase): boolean {
  return phase === 'technique';
}

export function seatsLeft(seats: number, activeEnrollments: number): number {
  return seats - activeEnrollments;
}
