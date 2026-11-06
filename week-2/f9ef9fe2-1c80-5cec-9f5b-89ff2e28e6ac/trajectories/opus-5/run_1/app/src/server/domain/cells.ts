import { LOOM_END_MINUTE, LOOM_START_MINUTE } from '../../shared/types.js';
import { hhmmToMinutes, minutesToHHMM } from '../../shared/format.js';
import { ApiFailure, failures } from '../http/errors.js';
import type { CellRef } from './pricing.js';
import { daysBetween, isValidDate } from './time.js';

export const MAX_CELLS_PER_REQUEST = 320;
export const BOOKING_HORIZON_DAYS = 365;

export function validateBookingDate(value: unknown, today: string): ApiFailure | null {
  if (!isValidDate(value)) {
    return failures.validation({ date: 'Give a kitchen date as YYYY-MM-DD.' });
  }
  const offset = daysBetween(today, value);
  if (offset < 0 || offset > BOOKING_HORIZON_DAYS) {
    return failures.validation({
      date: `Choose a date from ${today} through ${BOOKING_HORIZON_DAYS} days later.`,
    });
  }
  return null;
}

/** The booking date of a request, or the matching validation failure. */
export function readBookingDate(value: unknown, today: string): string {
  const failure = validateBookingDate(value, today);
  if (failure) throw failure;
  if (!isValidDate(value)) throw failures.validation({ date: 'Give a kitchen date as YYYY-MM-DD.' });
  return value;
}

export function parseCells(
  value: unknown,
  stationIds: ReadonlySet<string>,
): { cells: CellRef[] } | { failure: ApiFailure } {
  const invalid = (message: string): { failure: ApiFailure } => ({
    failure: failures.validation({ cells: message }),
  });
  if (!Array.isArray(value) || value.length === 0) {
    return invalid(`Send 1 to ${MAX_CELLS_PER_REQUEST} cells.`);
  }
  if (value.length > MAX_CELLS_PER_REQUEST) {
    return invalid(`Send at most ${MAX_CELLS_PER_REQUEST} cells.`);
  }
  const cells: CellRef[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return invalid('Each cell needs a station and a start.');
    const record = entry as Record<string, unknown>;
    const stationId = record.station_id;
    const start = record.start;
    if (typeof stationId !== 'string' || !stationIds.has(stationId)) {
      return invalid('Choose stations of this kitchen.');
    }
    if (typeof start !== 'string') return invalid('Give each start as HH:MM.');
    const minute = hhmmToMinutes(start);
    if (
      minute === null ||
      minute % 15 !== 0 ||
      minute < LOOM_START_MINUTE ||
      minute > LOOM_END_MINUTE - 15
    ) {
      return invalid('Starts run on the quarter hour from 04:00 to 23:45.');
    }
    const key = `${stationId}@${minute}`;
    if (seen.has(key)) return invalid('Send each cell once.');
    seen.add(key);
    cells.push({ station_id: stationId, start_minute: minute });
  }
  return { cells };
}

/**
 * The booking horizon and cell checks, in precedence order: compliance cover,
 * then the same-day cutoff, then cells that have already started.
 */
export function checkCellsAreBookable(input: {
  date: string;
  today: string;
  nowMinutes: number;
  sameDayCutoffMinutes: number;
  covered: boolean;
  cells: readonly CellRef[];
}): ApiFailure | null {
  if (!input.covered) {
    return failures.complianceBlocked(`Papers do not cover ${input.date}.`);
  }
  if (input.date !== input.today) return null;
  if (input.nowMinutes >= input.sameDayCutoffMinutes) {
    return failures.sameDayClosed(minutesToHHMM(input.sameDayCutoffMinutes));
  }
  if (input.cells.some((cell) => cell.start_minute <= input.nowMinutes)) {
    return failures.cellInPast();
  }
  return null;
}
