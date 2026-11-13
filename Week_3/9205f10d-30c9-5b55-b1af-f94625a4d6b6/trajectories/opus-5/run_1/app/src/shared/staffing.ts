import type { RequestStatus, SeatLabel, SeatStatus } from './types.js';

export const DEFAULT_ROTATION_MINUTES = 20;
const SOLO_MAX_DURATION_MINUTES = 60;

/** The one team-size default rule: over an hour needs a team of two. */
export function defaultTeamSize(durationMinutes: number): number {
  return durationMinutes > SOLO_MAX_DURATION_MINUTES ? 2 : 1;
}

export function seatLabelsForTeamSize(teamSize: number): SeatLabel[] {
  return teamSize > 1 ? ['A', 'B'] : ['A'];
}

const DERIVED_FROM_SEATS: readonly RequestStatus[] = ['submitted', 'half-staffed', 'staffed'];

/**
 * The one derived staffing status rule. Draft, completed, invoiced and cancelled
 * statuses are not derived from seats and are returned unchanged.
 */
export function derivedStatus(
  current: RequestStatus,
  seats: readonly { status: SeatStatus }[],
): RequestStatus {
  if (!DERIVED_FROM_SEATS.includes(current)) return current;
  const confirmed = seats.filter((seat) => seat.status === 'confirmed').length;
  if (confirmed === 0) return 'submitted';
  if (confirmed === seats.length) return 'staffed';
  return 'half-staffed';
}
