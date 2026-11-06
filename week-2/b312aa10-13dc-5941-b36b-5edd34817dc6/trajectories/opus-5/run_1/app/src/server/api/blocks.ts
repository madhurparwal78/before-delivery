/** Validating a requested block and pricing it, for holds and moves alike. */
import { addDays, daysBetween, minutesOfDay, parseLocalTime } from '../../shared/calendar.js';
import {
  hourlyChargeCents,
  peakQuarters,
  shelfChargeCents,
  versionAt,
} from '../domain/rates.js';
import { dayStartInstant, localDateOf, localMonthOf, localToInstant } from '../domain/time.js';
import type { Kitchen, Station, StationKind } from '../domain/types.js';
import { fieldCopy } from '../http/errors.js';
import { FieldErrors } from './validate.js';

export type Block = {
  stationId: string;
  kind: StationKind;
  localDate: string;
  localStart: string | null;
  localEnd: string | null;
  days: number | null;
  startMs: number;
  endMs: number;
  month: string;
  quarterHours: number;
  peakQuarters: number;
  chargeCents: number;
};

export type BlockRequest =
  | { kind: 'hourly'; date: string; start: string; end: string }
  | { kind: 'shelf'; date: string; days: number };

function onQuarterStart(time: string): boolean {
  const parsed = parseLocalTime(time);
  return parsed !== null && parsed.minute % 15 === 0 && parsed.hour <= 23;
}

function onQuarterEnd(time: string): boolean {
  const parsed = parseLocalTime(time);
  if (!parsed) return false;
  if (parsed.hour === 24) return parsed.minute === 0;
  return parsed.minute % 15 === 0;
}

/** The format rows for a date, a start and an end, then the whole-block rows. */
export function validateHourly(
  fieldErrors: FieldErrors,
  kitchen: Kitchen,
  nowMs: number,
  request: { date: string; start: string; end: string },
): { startMs: number; endMs: number } | null {
  if (!onQuarterStart(request.start)) fieldErrors.add('start', fieldCopy.quarterHour);
  if (!onQuarterEnd(request.end)) fieldErrors.add('end', fieldCopy.quarterHour);
  if (fieldErrors.any) return null;

  const zone = kitchen.timeZone;
  const startMs = localToInstant(zone, request.date, request.start);
  const endMs = localToInstant(zone, request.date, request.end);
  if (startMs === null) {
    fieldErrors.add('start', fieldCopy.nonexistentTime(request.start, request.date, zone));
  }
  if (endMs === null) {
    fieldErrors.add('end', fieldCopy.nonexistentTime(request.end, request.date, zone));
  }
  if (fieldErrors.any) return null;

  const startMinutes = minutesOfDay(request.start);
  const endMinutes = minutesOfDay(request.end);
  if (endMinutes <= startMinutes) {
    fieldErrors.add('end', fieldCopy.endAfterStart);
    return null;
  }
  const length = endMinutes - startMinutes;
  if (length < 60) fieldErrors.add('end', fieldCopy.tooShort);
  else if (length > 720) fieldErrors.add('end', fieldCopy.tooLong);
  else if (endMs! <= nowMs) fieldErrors.add('end', fieldCopy.alreadyEnded);
  checkHorizon(fieldErrors, kitchen, nowMs, request.date);
  return fieldErrors.any ? null : { startMs: startMs!, endMs: endMs! };
}

export function validateShelf(
  fieldErrors: FieldErrors,
  kitchen: Kitchen,
  nowMs: number,
  request: { date: string; days: number },
): { startMs: number; endMs: number } | null {
  const zone = kitchen.timeZone;
  const startMs = dayStartInstant(zone, request.date);
  const endMs = dayStartInstant(zone, addDays(request.date, request.days));
  if (endMs <= nowMs) fieldErrors.add('date', fieldCopy.alreadyEnded);
  checkHorizon(fieldErrors, kitchen, nowMs, request.date);
  return fieldErrors.any ? null : { startMs, endMs };
}

function checkHorizon(
  fieldErrors: FieldErrors,
  kitchen: Kitchen,
  nowMs: number,
  date: string,
): void {
  const today = localDateOf(kitchen.timeZone, nowMs);
  if (daysBetween(today, date) > 180) fieldErrors.add('date', fieldCopy.tooFarAhead);
}

/** Prices a block at the rate version in force for its start and the current peak windows. */
export function priceBlock(
  station: Station,
  kitchen: Kitchen,
  request: BlockRequest,
  span: { startMs: number; endMs: number },
): Block {
  const version = versionAt(station.rates, span.startMs);
  if (request.kind === 'shelf') {
    return {
      stationId: station.id,
      kind: 'shelf',
      localDate: request.date,
      localStart: null,
      localEnd: null,
      days: request.days,
      startMs: span.startMs,
      endMs: span.endMs,
      month: localMonthOf(kitchen.timeZone, span.startMs),
      quarterHours: 0,
      peakQuarters: 0,
      chargeCents: shelfChargeCents(request.days, version.shelfDayCents ?? 0),
    };
  }
  const quarters = (minutesOfDay(request.end) - minutesOfDay(request.start)) / 15;
  const peak = peakQuarters(request.date, request.start, request.end, kitchen.peakWindows);
  return {
    stationId: station.id,
    kind: 'hourly',
    localDate: request.date,
    localStart: request.start,
    localEnd: request.end,
    days: null,
    startMs: span.startMs,
    endMs: span.endMs,
    month: localMonthOf(kitchen.timeZone, span.startMs),
    quarterHours: quarters,
    peakQuarters: peak,
    chargeCents: hourlyChargeCents(
      quarters,
      peak,
      version.offPeakHourlyCents ?? 0,
      version.peakHourlyCents ?? 0,
    ),
  };
}

/** The kitchen-local dates a shelf block covers. */
export function shelfDates(date: string, days: number): string[] {
  return Array.from({ length: days }, (_, offset) => addDays(date, offset));
}
