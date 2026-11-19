// Schedule helpers: open windows in a zone, DST-exact wall times, display formats.

import { civilToEpoch, partsOf, dateStr, fmtStamp } from '../shared/time.js';

export interface ScheduleRow {
  name: string;
  time_zone: string;
  hours: Record<string, Array<[string, string]>>;
  holidays: string[];
}

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = typeof DAY_KEYS[number];

const WEEKDAY_TO_KEY: Record<number, DayKey> = { 0: 'mon', 1: 'tue', 2: 'wed', 3: 'thu', 4: 'fri', 5: 'sat', 6: 'sun' };

export function weekdayKey(epochMs: number, tz: string): DayKey {
  return WEEKDAY_TO_KEY[partsOf(epochMs, tz).weekday];
}

function parseWall(text: string): { h: number; mi: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi !== 0)) return null;
  return { h, mi };
}

/** All open windows [start,end) in epoch ms that overlap [from,to).
 *  A 24:00 close means the whole local day. */
export function openWindowsForRange(schedule: ScheduleRow, from: number, to: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const tz = schedule.time_zone;
  if (to <= from) return out;

  const firstDay = partsOf(from, tz);
  const lastDay = partsOf(Math.max(from, to - 1), tz);
  const holidays = new Set(schedule.holidays);
  let dayEpoch = civilToEpoch(firstDay.y, firstDay.mo, firstDay.d, 0, 0, 0, tz);
  const lastDayEpoch = civilToEpoch(lastDay.y, lastDay.mo, lastDay.d, 0, 0, 0, tz);

  for (let guard = 0; guard < 4000 && dayEpoch <= lastDayEpoch; guard++) {
    const p = partsOf(dayEpoch, tz);
    const date = dateStr(dayEpoch, tz);
    if (!holidays.has(date)) {
      const windows = schedule.hours[WEEKDAY_TO_KEY[p.weekday]] ?? [];
      for (const [a, b] of windows) {
        const wa = parseWall(a);
        const wb = parseWall(b);
        if (!wa || !wb) continue;
        const start = civilToEpoch(p.y, p.mo, p.d, wa.h, wa.mi, 0, tz);
        let end: number;
        if (wb.h === 24) {
          const next = partsOf(dayEpoch + 86_400_000, tz);
          end = civilToEpoch(next.y, next.mo, next.d, 0, 0, 0, tz);
        } else {
          end = civilToEpoch(p.y, p.mo, p.d, wb.h, wb.mi, 0, tz);
        }
        if (end > start) out.push([start, end]);
      }
    }
    dayEpoch += 86_400_000;
  }
  return out;
}

/** Business seconds in [start, end) clipped to open windows. */
export function businessSeconds(schedule: ScheduleRow, start: number, end: number): number {
  if (end <= start) return 0;
  let total = 0;
  for (const [s, e] of openWindowsForRange(schedule, start, end)) {
    const cs = Math.max(s, start);
    const ce = Math.min(e, end);
    if (ce > cs) total += Math.floor((ce - cs) / 1000);
  }
  return total;
}

/** Is the schedule open at an instant? */
export function isOpenAt(schedule: ScheduleRow, at: number): boolean {
  const date = dateStr(at, schedule.time_zone);
  if (schedule.holidays.includes(date)) return false;
  const key = weekdayKey(at, schedule.time_zone);
  const windows = schedule.hours[key] ?? [];
  const p = partsOf(at, schedule.time_zone);
  for (const [a, b] of windows) {
    const wa = parseWall(a);
    const wb = parseWall(b);
    if (!wa || !wb) continue;
    const start = civilToEpoch(p.y, p.mo, p.d, wa.h, wa.mi, 0, schedule.time_zone);
    if (wb.h === 24) {
      const next = partsOf(at + 86_400_000, schedule.time_zone);
      const end = civilToEpoch(next.y, next.mo, next.d, 0, 0, 0, schedule.time_zone);
      if (at >= start && at < end) return true;
    } else {
      const end = civilToEpoch(p.y, p.mo, p.d, wb.h, wb.mi, 0, schedule.time_zone);
      if (at >= start && at < end) return true;
    }
  }
  return false;
}

/** Next instant at which open/closed changes after `from`, or null when the
 *  schedule is open all day every day with no holiday ahead. */
export function nextOpenChange(schedule: ScheduleRow, from: number): number | null {
  const tz = schedule.time_zone;
  const startOpen = isOpenAt(schedule, from);

  // If the schedule never closes after `from` (24/7 with no holidays), null.
  const alwaysOpen = DAY_KEYS.every(k => {
    const windows = schedule.hours[k] ?? [];
    return windows.length === 1 && windows[0][0] === '00:00' && windows[0][1] === '24:00';
  }) && !schedule.holidays.some(h => {
    const d = Date.parse(`${h}T00:00:00Z`);
    return d >= from;
  });
  if (alwaysOpen) return null;

  // Scan day windows for the boundary nearest after `from`.
  const horizon = from + 370 * 86_400_000;
  const candidates: number[] = [];
  let dayEpoch = from;
  for (let guard = 0; guard < 4000 && dayEpoch < horizon; guard++) {
    const date = dateStr(dayEpoch, tz);
    if (!schedule.holidays.includes(date)) {
      const key = weekdayKey(dayEpoch, tz);
      const windows = schedule.hours[key] ?? [];
      const p = partsOf(dayEpoch, tz);
      for (const [a, b] of windows) {
        const wa = parseWall(a);
        const wb = parseWall(b);
        if (!wa || !wb) continue;
        const start = civilToEpoch(p.y, p.mo, p.d, wa.h, wa.mi, 0, tz);
        candidates.push(start);
        if (wb.h === 24) {
          const next = partsOf(dayEpoch + 86_400_000, tz);
          candidates.push(civilToEpoch(next.y, next.mo, next.d, 0, 0, 0, tz));
        } else {
          candidates.push(civilToEpoch(p.y, p.mo, p.d, wb.h, wb.mi, 0, tz));
        }
      }
    }
    dayEpoch += 86_400_000;
  }
  const next = candidates.filter(c => c > from).sort((x, y) => x - y)[0];
  if (next === undefined) return null;
  return next;
}

/** Display helper: YYYY-MM-DD HH:mm in a zone. */
export function stamp(epochMs: number, tz: string): string {
  return fmtStamp(epochMs, tz);
}

/** Midnight of the day in a zone. */
export function startOfDay(epochMs: number, tz: string): number {
  const p = partsOf(epochMs, tz);
  return civilToEpoch(p.y, p.mo, p.d, 0, 0, 0, tz);
}
