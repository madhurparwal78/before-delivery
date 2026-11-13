import type { BookingStatus, CoverageState, Setting } from '../../shared/api.js';
import { AGENCY, openCallLeadMinutes } from './agency.js';
import { addMinutes } from './time.js';

/** A booking longer than the solo threshold, or any legal booking, needs a team of two. */
export function seatCountForNewBooking(setting: Setting, durationMinutes: number): number {
  return durationMinutes > AGENCY.soloThresholdMinutes || setting === 'legal' ? 2 : 1;
}

export const PRE_CHECK_IN_STATUSES: BookingStatus[] = [
  'submitted',
  'open',
  'partially_covered',
  'covered',
];

export const FINAL_STATUSES: BookingStatus[] = ['completed', 'cancelled', 'cancelled_late'];

/** Before check-in a booking's status follows from its seats and whether an open call exists. */
export function statusFromSeats(
  seatsHeld: number,
  seatCount: number,
  openCallPosted: boolean,
): BookingStatus {
  if (seatsHeld === 0) return openCallPosted ? 'open' : 'submitted';
  if (seatsHeld < seatCount) return 'partially_covered';
  return 'covered';
}

export function coverageState(seatsHeld: number, seatCount: number): CoverageState {
  if (seatsHeld === 0) return 'uncovered';
  if (seatsHeld < seatCount) return 'partly_covered';
  return 'covered';
}

export function isPreCheckIn(status: BookingStatus): boolean {
  return PRE_CHECK_IN_STATUSES.includes(status);
}

export function isFinal(status: BookingStatus): boolean {
  return FINAL_STATUSES.includes(status);
}

/** The open call closes exactly the lead time, in elapsed minutes, before the start instant. */
export function openCallCloseInstant(start: Date): Date {
  return addMinutes(start, -openCallLeadMinutes());
}
