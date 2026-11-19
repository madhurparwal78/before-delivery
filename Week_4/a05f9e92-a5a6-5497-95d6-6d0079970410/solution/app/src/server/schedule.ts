import { addDays, dateKey, localParts, parseDateKey, wallToInstant, WEEKDAY_KEYS } from "../shared/tz.js";

export interface Schedule {
  name: string;
  time_zone: string;
  hours: Record<string, [string, string][]>;
  holidays: string[];
}

type Window = [number, number];

const dayCache = new Map<string, Window[]>();

function parseClock(text: string): { hour: number; minute: number } {
  const [h, m] = text.split(":").map(Number);
  return { hour: h!, minute: m! };
}

/** Open windows of one local date: holidays are closed; each window runs from its local opening to its local closing wall time. */
function dayWindows(schedule: Schedule, year: number, month: number, day: number): Window[] {
  const key = dateKey(year, month, day);
  if (schedule.holidays.includes(key)) return [];
  const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  const spans = schedule.hours[WEEKDAY_KEYS[weekday]!] ?? [];
  const cacheKey = `${schedule.time_zone}|${key}|${JSON.stringify(spans)}`;
  const cached = dayCache.get(cacheKey);
  if (cached) return cached;
  const windows = spans.map(([open, close]): Window => {
    const o = parseClock(open);
    const c = parseClock(close);
    const start = wallToInstant(year, month, day, o.hour, o.minute, schedule.time_zone);
    const end =
      c.hour === 24
        ? (() => {
            const next = addDays(year, month, day, 1);
            return wallToInstant(next.year, next.month, next.day, 0, 0, schedule.time_zone);
          })()
        : wallToInstant(year, month, day, c.hour, c.minute, schedule.time_zone);
    return [start, end];
  });
  if (dayCache.size > 20_000) dayCache.clear();
  dayCache.set(cacheKey, windows);
  return windows;
}

function eachDay(schedule: Schedule, fromMs: number, toMs: number, visit: (windows: Window[]) => boolean | void): void {
  const first = localParts(fromMs, schedule.time_zone);
  const last = localParts(toMs, schedule.time_zone);
  const end = Date.UTC(last.year, last.month - 1, last.day);
  for (let cursor = Date.UTC(first.year, first.month - 1, first.day); cursor <= end; cursor += 86_400_000) {
    const d = new Date(cursor);
    if (visit(dayWindows(schedule, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())) === false) return;
  }
}

/** Seconds of the interval that fall inside the schedule's open windows. */
export function businessSeconds(schedule: Schedule, fromMs: number, toMs: number): number {
  if (toMs <= fromMs) return 0;
  let total = 0;
  eachDay(schedule, fromMs, toMs, (windows) => {
    for (const [start, end] of windows) {
      const overlap = Math.min(end, toMs) - Math.max(start, fromMs);
      if (overlap > 0) total += overlap;
    }
  });
  return Math.round(total / 1000);
}

export function isOpen(schedule: Schedule, atMs: number): boolean {
  let open = false;
  eachDay(schedule, atMs, atMs, (windows) => {
    open = windows.some(([start, end]) => atMs >= start && atMs < end);
  });
  return open;
}

const HORIZON_DAYS = 400;

/** The next instant at which open/closed would change, or null when it never does within a year. */
export function nextChange(schedule: Schedule, atMs: number): number | null {
  const merged: Window[] = [];
  const start = localParts(atMs, schedule.time_zone);
  const last = addDays(start.year, start.month, start.day, HORIZON_DAYS);
  const horizon = wallToInstant(last.year, last.month, last.day, 0, 0, schedule.time_zone);
  eachDay(schedule, atMs, horizon, (windows) => {
    for (const w of windows) {
      const tail = merged[merged.length - 1];
      if (tail && w[0] <= tail[1]) tail[1] = Math.max(tail[1], w[1]);
      else merged.push([w[0], w[1]]);
    }
  });
  const containing = merged.find(([s, e]) => atMs >= s && atMs < e);
  if (containing) return containing[1] >= horizon ? null : containing[1];
  const upcoming = merged.find(([s]) => s > atMs);
  return upcoming ? upcoming[0] : null;
}

/** Whole open days (not holidays, with hours) after a local date key up to and including the local date of an instant. */
export function openDaysBetween(schedule: Schedule, fromKey: string, toMs: number): number {
  const start = parseDateKey(fromKey);
  const first = addDays(start.year, start.month, start.day, 1);
  const last = localParts(toMs, schedule.time_zone);
  const end = Date.UTC(last.year, last.month - 1, last.day);
  let count = 0;
  for (let cursor = Date.UTC(first.year, first.month - 1, first.day); cursor <= end; cursor += 86_400_000) {
    const d = new Date(cursor);
    if (dayWindows(schedule, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()).length > 0) count++;
  }
  return count;
}

/** The instant of the same local wall time on the n-th open day after a local date. */
export function nthOpenDayAfter(schedule: Schedule, anchorMs: number, openDays: number): number {
  const anchor = localParts(anchorMs, schedule.time_zone);
  let cursor = Date.UTC(anchor.year, anchor.month - 1, anchor.day);
  let seen = 0;
  while (seen < openDays) {
    cursor += 86_400_000;
    const d = new Date(cursor);
    if (dayWindows(schedule, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()).length > 0) seen++;
  }
  const d = new Date(cursor);
  return wallToInstant(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), anchor.hour, anchor.minute, schedule.time_zone) + anchor.second * 1000;
}
