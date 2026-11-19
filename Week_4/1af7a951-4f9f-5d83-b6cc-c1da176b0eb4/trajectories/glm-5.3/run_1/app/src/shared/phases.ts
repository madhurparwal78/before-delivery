import type { CohortPhase } from './domain.js';
import { addDays, daysBetween } from './timezones.js';

// The cohort phase is decided from the server date in the coach's time zone.
// The published phase is stored alongside; when the server date passes a
// boundary the stored phase moves on and the row is marked to refresh.
export function datePhaseFor(startsOn: string, today: string, published: boolean): CohortPhase {
  if (!published) return 'draft';
  if (daysBetween(startsOn, today) >= 28) return 'closed';
  if (daysBetween(startsOn, today) >= 7) return 'technique';
  if (daysBetween(startsOn, today) >= 0) return 'baseline';
  return 'enrolling';
}

export function weekFor(startsOn: string, today: string): number | null {
  const elapsed = daysBetween(startsOn, today);
  if (elapsed < 0) return null;
  return Math.min(Math.floor(elapsed / 7) + 1, 4);
}

export const FIRST_NIGHT = 0;

export function lastNightOf(startsOn: string): string {
  return addDays(startsOn, 27);
}
