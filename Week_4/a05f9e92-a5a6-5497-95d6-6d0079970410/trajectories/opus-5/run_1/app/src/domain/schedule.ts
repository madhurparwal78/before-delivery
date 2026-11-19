/**
 * Business schedules: weekly opening hours, holiday dates and an IANA zone.
 * Elapsed business time counts only the open hours of the schedule's local days
 * and skips holidays. This is the one place open windows are decided.
 */

import {
  addDays,
  localDate,
  type LocalDate,
  wallTimeOn,
  weekdayOf,
  type WeekdayKey,
} from './zone';

export type HourRange = readonly [string, string];

export interface BusinessSchedule {
  readonly name: string;
  readonly timeZone: string;
  readonly hours: Readonly<Record<WeekdayKey, readonly HourRange[]>>;
  readonly holidays: readonly LocalDate[];
}

export interface Interval {
  readonly start: number;
  readonly end: number;
}

const dayMs = 86_400_000;

export function isHoliday(schedule: BusinessSchedule, date: LocalDate): boolean {
  return schedule.holidays.includes(date);
}

/** A local date that is not a holiday and has opening hours on this schedule. */
export function isOpenDay(schedule: BusinessSchedule, date: LocalDate): boolean {
  if (isHoliday(schedule, date)) return false;
  const ranges = schedule.hours[weekdayOf(date)];
  return ranges !== undefined && ranges.length > 0;
}

/** The open windows of one local date, as instants. */
export function windowsOnDate(schedule: BusinessSchedule, date: LocalDate): Interval[] {
  if (!isOpenDay(schedule, date)) return [];
  const ranges = schedule.hours[weekdayOf(date)] ?? [];
  const out: Interval[] = [];
  for (const [from, to] of ranges) {
    const start = wallTimeOn(schedule.timeZone, date, from);
    const end = wallTimeOn(schedule.timeZone, date, to);
    if (end > start) out.push({ start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * The open windows overlapping an instant range. Days are walked in the
 * schedule's zone, so each day's opening and closing wall times convert with
 * that day's own offset.
 */
export function openWindows(schedule: BusinessSchedule, from: number, to: number): Interval[] {
  if (to <= from) return [];
  const out: Interval[] = [];
  let date = addDays(localDate(schedule.timeZone, from), -1);
  const last = addDays(localDate(schedule.timeZone, to), 1);
  for (let guard = 0; date <= last && guard < 4000; guard += 1, date = addDays(date, 1)) {
    for (const w of windowsOnDate(schedule, date)) {
      const start = Math.max(w.start, from);
      const end = Math.min(w.end, to);
      if (end > start) out.push({ start, end });
    }
  }
  return out;
}

/** Business seconds inside one instant range. */
export function businessSecondsBetween(schedule: BusinessSchedule, from: number, to: number): number {
  let ms = 0;
  for (const w of openWindows(schedule, from, to)) ms += w.end - w.start;
  return Math.floor(ms / 1000);
}

/** Business seconds inside a set of ranges. */
export function businessSecondsOver(schedule: BusinessSchedule, intervals: readonly Interval[]): number {
  let ms = 0;
  for (const i of mergeIntervals(intervals)) {
    for (const w of openWindows(schedule, i.start, i.end)) ms += w.end - w.start;
  }
  return Math.floor(ms / 1000);
}

export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) {
      if (i.end > last.end) out[out.length - 1] = { start: last.start, end: i.end };
    } else {
      out.push({ start: i.start, end: i.end });
    }
  }
  return out;
}

export function subtractIntervals(base: readonly Interval[], cut: readonly Interval[]): Interval[] {
  let out = mergeIntervals(base);
  for (const c of mergeIntervals(cut)) {
    const next: Interval[] = [];
    for (const b of out) {
      if (c.end <= b.start || c.start >= b.end) {
        next.push(b);
        continue;
      }
      if (c.start > b.start) next.push({ start: b.start, end: c.start });
      if (c.end < b.end) next.push({ start: c.end, end: b.end });
    }
    out = next;
  }
  return out;
}

export function intersectIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of mergeIntervals(a)) {
    for (const y of mergeIntervals(b)) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return out;
}

export function isOpenAt(schedule: BusinessSchedule, instant: number): boolean {
  const date = localDate(schedule.timeZone, instant);
  for (const d of [addDays(date, -1), date]) {
    for (const w of windowsOnDate(schedule, d)) {
      if (instant >= w.start && instant < w.end) return true;
    }
  }
  return false;
}

/**
 * The next instant at which being inside an open window would change: the
 * closing time when open, the next opening time when closed. Null when a
 * schedule can never change by itself.
 */
export function nextOpenChange(schedule: BusinessSchedule, instant: number): number | null {
  if (alwaysOpen(schedule)) return null;
  const date = localDate(schedule.timeZone, instant);
  let cursor = addDays(date, -1);
  for (let guard = 0; guard < 800; guard += 1, cursor = addDays(cursor, 1)) {
    for (const w of windowsOnDate(schedule, cursor)) {
      if (instant >= w.start && instant < w.end) return w.end;
      if (w.start > instant) return w.start;
    }
  }
  return null;
}

/** A schedule open all day on every day with no holiday ahead can never change. */
export function alwaysOpen(schedule: BusinessSchedule): boolean {
  if (schedule.holidays.length > 0) return false;
  return (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as WeekdayKey[]).every((d) => {
    const ranges = schedule.hours[d] ?? [];
    return ranges.length === 1 && ranges[0][0] === '00:00' && (ranges[0][1] === '24:00' || ranges[0][1] === '00:00');
  });
}

/**
 * The instant at which `seconds` of business time will have elapsed from a
 * start, skipping closed time. Null when the schedule never opens again.
 */
export function instantAfterBusinessSeconds(
  schedule: BusinessSchedule,
  from: number,
  seconds: number,
): number | null {
  if (seconds <= 0) return from;
  let remainingMs = seconds * 1000;
  let date = addDays(localDate(schedule.timeZone, from), -1);
  for (let guard = 0; guard < 4000; guard += 1, date = addDays(date, 1)) {
    for (const w of windowsOnDate(schedule, date)) {
      const start = Math.max(w.start, from);
      if (w.end <= start) continue;
      const span = w.end - start;
      if (span >= remainingMs) return start + remainingMs;
      remainingMs -= span;
    }
  }
  return null;
}

/** The nth open day strictly after a local date. */
export function openDayAfter(schedule: BusinessSchedule, date: LocalDate, n: number): LocalDate {
  let cursor = date;
  let left = n;
  for (let guard = 0; left > 0 && guard < 4000; guard += 1) {
    cursor = addDays(cursor, 1);
    if (isOpenDay(schedule, cursor)) left -= 1;
  }
  return cursor;
}

/** Whole open days between a past instant and now, for business_days_since. */
export function businessDaysSince(schedule: BusinessSchedule, from: number, to: number): number {
  if (to <= from) return 0;
  const fromDate = localDate(schedule.timeZone, from);
  const toDate = localDate(schedule.timeZone, to);
  let count = 0;
  let cursor = fromDate;
  for (let guard = 0; cursor < toDate && guard < 4000; guard += 1) {
    cursor = addDays(cursor, 1);
    if (isOpenDay(schedule, cursor)) count += 1;
  }
  return count;
}

export const dayLengthMs = dayMs;
