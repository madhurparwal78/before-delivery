/**
 * The cancellation cutoff: the booking's own start wall-clock time two
 * calendar days before its date, in kitchen time. A daylight-saving change
 * between the two days does not move it off that wall clock.
 */

import { addDays, kitchenInstant } from '../../shared/kitchenTime.js';

export const CANCELLATION_NOTICE_DAYS = 2;

export function cancellationCutoffAt(date: string, start: string): number {
  return kitchenInstant(addDays(date, -CANCELLATION_NOTICE_DAYS), start);
}

export type CancellationOutcome = 'credited' | 'forfeited';

/** Strictly before the cutoff the hours come back; at or after it they are forfeited. */
export function cancellationOutcome(cutoffAtMs: number, nowMs: number): CancellationOutcome {
  return nowMs < cutoffAtMs ? 'credited' : 'forfeited';
}
