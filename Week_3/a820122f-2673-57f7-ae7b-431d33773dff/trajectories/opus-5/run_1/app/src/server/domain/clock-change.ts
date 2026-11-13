import { ValidationError } from '../http/errors.js';
import { DAY_MS, MINUTE_MS } from './time.js';
import { offsetAt, shipDateOf, type VesselClock } from './ship-time.js';

export const MIN_OFFSET_MINUTES = -720;
export const MAX_OFFSET_MINUTES = 840;

/** The one place a logged clock change is accepted or refused. */
export function checkClockChange(
  clock: VesselClock,
  changesAtMs: number,
  newOffsetMinutes: number,
): { oldOffsetMinutes: number; shipDate: string } {
  const oldOffsetMinutes = offsetAt(clock, changesAtMs);
  if (
    newOffsetMinutes % 30 !== 0 ||
    newOffsetMinutes < MIN_OFFSET_MINUTES ||
    newOffsetMinutes > MAX_OFFSET_MINUTES
  ) {
    throw new ValidationError({
      new_offset_minutes:
        'A ship keeps a whole or half hour offset between -720 and 840 minutes from UTC.',
    });
  }
  if (newOffsetMinutes === oldOffsetMinutes) {
    throw new ValidationError({
      new_offset_minutes: 'The new offset is the same as the one the ship already keeps.',
    });
  }
  const latest = clock.changes.reduce(
    (latestMs, change) => Math.max(latestMs, change.changesAtMs),
    Number.NEGATIVE_INFINITY,
  );
  if (changesAtMs <= latest) {
    throw new ValidationError({
      changes_at_utc: 'Log clock changes in order: this one is not later than the last.',
    });
  }
  const readingBefore = changesAtMs + oldOffsetMinutes * MINUTE_MS;
  const readingAfter = changesAtMs + newOffsetMinutes * MINUTE_MS;
  if (Math.floor(readingBefore / DAY_MS) !== Math.floor(readingAfter / DAY_MS)) {
    throw new ValidationError({
      changes_at_utc: "Pick a time that keeps the clock change inside one ship's day.",
    });
  }
  const shipDate = shipDateOf(clock, changesAtMs);
  if (clock.changes.some((change) => shipDateOf(clock, change.changesAtMs) === shipDate)) {
    throw new ValidationError({
      changes_at_utc: "That ship's date already has a clock change.",
    });
  }
  return { oldOffsetMinutes, shipDate };
}
