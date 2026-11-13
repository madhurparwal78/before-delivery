import { ValidationError } from '../http/errors.js';
import { HOUR_MS, isAligned } from './time.js';
import { shipDayBounds, shipDateOf, type VesselClock } from './ship-time.js';

const ENTRY_HORIZON_HOURS = 48;

/** The one place a watch entry's instants are accepted or refused. */
export function checkWatchEntry(
  clock: VesselClock,
  startMs: number,
  endMs: number,
  nowMs: number,
): { shipDate: string } {
  if (!isAligned(startMs)) {
    throw new ValidationError({ start_utc: 'A start needs to fall on the hour or the half hour.' });
  }
  if (!isAligned(endMs)) {
    throw new ValidationError({ end_utc: 'An end needs to fall on the hour or the half hour.' });
  }
  if (endMs <= startMs) {
    throw new ValidationError({ end_utc: 'The end comes before the start.' });
  }
  const shipDate = shipDateOf(clock, startMs);
  const bounds = shipDayBounds(clock, shipDate);
  if (endMs > bounds.endMs) {
    throw new ValidationError({ end_utc: "Keep each entry inside one ship's day." });
  }
  if (endMs > nowMs + ENTRY_HORIZON_HOURS * HOUR_MS) {
    throw new ValidationError({ end_utc: 'Hours cannot be logged more than 48 hours ahead.' });
  }
  return { shipDate };
}
