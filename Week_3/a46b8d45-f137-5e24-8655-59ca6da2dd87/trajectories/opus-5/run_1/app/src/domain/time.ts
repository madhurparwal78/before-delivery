/**
 * The workshop calendar. Every purchase date, term end, edition start, working day and
 * dispatch cut-off is counted here on Europe/London, never on UTC and never on a device
 * clock. Local times are only ever used for display and for the cut-off wall time.
 */

import { config } from '../config';
import { WORKSHOP_ZONE } from '../shared/format';

export { WORKSHOP_ZONE };

/** A Europe/London calendar date, `YYYY-MM-DD`. */
export type LondonDate = string;

const DAY_MS = 86_400_000;

const dateTimeParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: WORKSHOP_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instant: Date): WallClock {
  const parts = dateTimeParts.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (!part) throw new Error(`missing ${type} in formatted instant`);
    return Number(part.value);
  };
  // Midnight is formatted as hour 24 by some ICU builds; the day has already rolled.
  const hour = read('hour') % 24;
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
    second: read('second'),
  };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** "Now" is the server's clock, or the frozen instant when `DESK_CLOCK_FROZEN_AT` is set. */
export function now(): Date {
  if (config.deskClockFrozenAt !== null) {
    const frozen = new Date(config.deskClockFrozenAt);
    if (Number.isNaN(frozen.getTime())) throw new Error('DESK_CLOCK_FROZEN_AT must be an ISO 8601 instant');
    return frozen;
  }
  return new Date();
}

/** The instant's business day: its Europe/London calendar date. */
export function londonDate(instant: Date): LondonDate {
  const wall = wallClock(instant);
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}

export function isLondonDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function utcFromWall(date: LondonDate, hour: number, minute: number): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day, hour, minute, 0, 0);
}

/** The Europe/London offset in minutes that applies at an instant. */
function offsetMinutes(instant: Date): number {
  const wall = wallClock(instant);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * The instant a Europe/London wall time names. When the clocks change:
 * a wall time skipped in spring resolves to the first instant after the gap, and a wall
 * time repeated in autumn resolves to the earlier of its two instants.
 */
export function londonInstant(date: LondonDate, hour: number, minute: number): Date {
  const wanted = utcFromWall(date, hour, minute);
  const matches: number[] = [];
  for (const candidateOffset of [60, 0]) {
    const candidate = wanted - candidateOffset * 60_000;
    if (offsetMinutes(new Date(candidate)) === candidateOffset) matches.push(candidate);
  }
  // Two matches is the repeated autumn hour; the earlier instant is the larger offset.
  if (matches.length > 0) return new Date(Math.min(...matches));
  return new Date(transitionInstant(date));
}

/** The instant the Europe/London offset changes on a day that gains or loses an hour. */
function transitionInstant(date: LondonDate): number {
  let low = utcFromWall(date, 0, 0) - 60_000;
  let high = low + DAY_MS + 120 * 60_000;
  const before = offsetMinutes(new Date(low));
  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (offsetMinutes(new Date(middle)) === before) low = middle;
    else high = middle;
  }
  return high;
}

/** 00:00 Europe/London at the start of a calendar day. */
export function startOfLondonDay(date: LondonDate): Date {
  return londonInstant(date, 0, 0);
}

export function addLondonDays(date: LondonDate, days: number): LondonDate {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/**
 * The purchase date plus a number of calendar months. When that day of the month does not
 * exist, the anniversary is the first day of the next month.
 */
export function addLondonMonths(date: LondonDate, months: number): LondonDate {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const total = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = (total % 12) + 1;
  if (day <= daysInMonth(targetYear, targetMonth)) {
    return `${pad(targetYear, 4)}-${pad(targetMonth)}-${pad(day)}`;
  }
  const rolledTotal = targetYear * 12 + (targetMonth - 1) + 1;
  return `${pad(Math.floor(rolledTotal / 12), 4)}-${pad((rolledTotal % 12) + 1)}-01`;
}

function weekday(date: LondonDate): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Working days are Monday to Friday, except the workshop's bank holidays. */
export function isWorkingDay(date: LondonDate, bankHolidays: ReadonlySet<LondonDate>): boolean {
  const day = weekday(date);
  return day !== 0 && day !== 6 && !bankHolidays.has(date);
}

export function nextWorkingDay(date: LondonDate, bankHolidays: ReadonlySet<LondonDate>): LondonDate {
  let candidate = addLondonDays(date, 1);
  while (!isWorkingDay(candidate, bankHolidays)) candidate = addLondonDays(candidate, 1);
  return candidate;
}

export function addWorkingDays(date: LondonDate, count: number, bankHolidays: ReadonlySet<LondonDate>): LondonDate {
  let candidate = date;
  for (let step = 0; step < count; step += 1) candidate = nextWorkingDay(candidate, bankHolidays);
  return candidate;
}

/**
 * The one place that judges a closing instant: an instant at or after it is outside.
 * Confirmation links, aftercare cover, edition starts and the dispatch cut-off all ask here.
 */
export function isBefore(instant: Date, closingInstant: Date): boolean {
  return instant.getTime() < closingInstant.getTime();
}
