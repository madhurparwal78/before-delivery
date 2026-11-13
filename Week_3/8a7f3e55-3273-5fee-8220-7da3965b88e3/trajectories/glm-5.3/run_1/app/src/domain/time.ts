// Fixed zone-info data for America/Chicago, 2026-2040. The server has no zoneinfo database
// guarantee, so the agency zone rules are stated once here and used by the single resolver.

const REGULAR_OFFSET_MINUTES = -360; // CST UTC-6 (offset signed east of UTC; local = utc + offset)
const DAYLIGHT_OFFSET_MINUTES = -300; // CDT UTC-5

// DST begins 02:00 local standard on the second Sunday of March and ends 02:00 local
// daylight on the first Sunday of November (post-2007 US rules).
export interface ZoneInterval { startUTC: number; endUTC: number; offsetMinutes: number }

const intervalCache = new Map<number, ZoneInterval[]>();

export function zoneIntervals(yearFrom: number, yearTo: number): ZoneInterval[] {
  const cacheKey = yearFrom * 10000 + yearTo;
  const cached = intervalCache.get(cacheKey);
  if (cached) return cached;
  const out: ZoneInterval[] = [];
  const springUTC = (year: number) =>
    Date.UTC(year, 2, secondSunday(year), 2) - REGULAR_OFFSET_MINUTES * 60000;
  const fallUTC = (year: number) =>
    Date.UTC(year, 10, firstSunday(year), 2) - DAYLIGHT_OFFSET_MINUTES * 60000;
  let cursor = Number.NEGATIVE_INFINITY;
  for (let year = yearFrom; year <= yearTo; year++) {
    const spring = springUTC(year);
    const fall = fallUTC(year);
    out.push({ startUTC: cursor, endUTC: spring, offsetMinutes: REGULAR_OFFSET_MINUTES });
    out.push({ startUTC: spring, endUTC: fall, offsetMinutes: DAYLIGHT_OFFSET_MINUTES });
    cursor = fall;
  }
  out.push({ startUTC: cursor, endUTC: Number.POSITIVE_INFINITY, offsetMinutes: REGULAR_OFFSET_MINUTES });
  intervalCache.set(cacheKey, out);
  return out;
}

function secondSunday(year: number): number {
  const firstDow = new Date(Date.UTC(year, 2, 1)).getUTCDay();
  return 8 + ((0 - firstDow + 7) % 7);
}

function firstSunday(year: number): number {
  const firstDow = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  return 1 + ((0 - firstDow + 7) % 7);
}

export function offsetAt(utcMs: number): number {
  const year = new Date(utcMs).getUTCFullYear();
  const intervals = zoneIntervals(year - 1, year + 1);
  for (const iv of intervals) {
    if (utcMs >= iv.startUTC && utcMs < iv.endUTC) return iv.offsetMinutes;
  }
  return intervals.length > 0 ? intervals[intervals.length - 1].offsetMinutes : REGULAR_OFFSET_MINUTES;
}

/** Local wall-clock time (no offset) at the given instant, in the agency zone. */
export function localParts(utcMs: number): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const shifted = new Date(utcMs + offsetAt(utcMs) * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

export type ResolvedStart = { ok: true; instantMs: number } | { ok: false };

/** Resolve an agency wall-clock time. A time skipped by the spring change does not exist.
 * A time repeated by the fall change means its first occurrence. */
export function resolveWallClock(y: number, m: number, d: number, hh: number, mm: number): ResolvedStart {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // instant = wall - offset (offset is signed east of UTC; Chicago is negative).
  const offEarly = offsetAt(wall - 8 * 3600_000);
  const instantEarly = wall - offEarly * 60000;
  if (offsetAt(instantEarly) === offEarly) return { ok: true, instantMs: instantEarly };
  const offLate = offsetAt(wall + 8 * 3600_000);
  if (offLate === offEarly) return { ok: true, instantMs: instantEarly };
  const instantLate = wall - offLate * 60000;
  if (offsetAt(instantLate) === offLate) {
    // Fall back: the wall time occurs twice; offLate is the offset before the change, which
    // is the first occurrence's offset.
    return { ok: true, instantMs: instantLate };
  }
  return { ok: false };
}

/** The first valid instant at or after the given wall-clock time on that date. */
export function nextValidInstant(y: number, m: number, d: number, hh: number, mm: number): number {
  for (let addMin = 0; addMin <= 24 * 60; addMin++) {
    const total = hh * 60 + mm + addMin;
    const day = d + Math.floor(total / (24 * 60));
    const hour = Math.floor((total % (24 * 60)) / 60);
    const minute = total % 60;
    const r = resolveWallClock(y, m, day, hour, minute);
    if (r.ok) return r.instantMs;
  }
  const r = resolveWallClock(y, m, d, hh, mm);
  return r.ok ? r.instantMs : Date.UTC(y, m - 1, d, hh, mm);
}

export function offsetForLocal(y: number, m: number, d: number): number {
  const approx = Date.UTC(y, m - 1, d, 12);
  return offsetAt(approx);
}

/** Format an instant as ISO 8601 with the agency offset in force at that instant. */
export function formatInstant(utcMs: number): string {
  const off = offsetAt(utcMs);
  const shifted = new Date(utcMs + off * 60000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return (
    `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}` +
    `T${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}` +
    `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
  );
}

export function formatDate(utcMs: number): string {
  const p = localParts(utcMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function formatTime(utcMs: number): string {
  const p = localParts(utcMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatDateTime(utcMs: number): string {
  return `${formatDate(utcMs)} ${formatTime(utcMs)}`;
}

export function localDateOfInstant(utcMs: number): string {
  return formatDate(utcMs);
}

export function todayLocal(nowMs: number): string {
  return formatDate(nowMs);
}

/** Parse an agency-local date string into the instant of local noon (safe for date arithmetic). */
export function dateNoon(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 12);
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return formatDate(Date.UTC(y, m - 1, d + days, 12));
}

export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isMonday(dateStr: string): boolean {
  return weekdayOf(dateStr) === 1;
}

/** The Monday of the agency-local week containing dateStr (Monday to Sunday weeks). */
export function weekMondayOf(dateStr: string): string {
  const wd = weekdayOf(dateStr);
  return addDaysToDateString(dateStr, wd === 0 ? -6 : 1 - wd);
}

/** The late-cancellation cutoff: the start moved back two business days, keeping the
 * wall-clock time. Business days are Monday to Friday; a Saturday start has a Thursday cutoff. */
export function businessDaysBack(startInstant: number, days: number): number {
  const start = localParts(startInstant);
  let dateStr = `${start.year}-${String(start.month).padStart(2, '0')}-${String(start.day).padStart(2, '0')}`;
  let back = days;
  while (back > 0) {
    dateStr = addDaysToDateString(dateStr, -1);
    if (weekdayOf(dateStr) >= 1 && weekdayOf(dateStr) <= 5) back--;
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  const resolved = resolveWallClock(y, m, d, start.hour, start.minute);
  if (resolved.ok) return resolved.instantMs;
  return nextValidInstant(y, m, d, start.hour, start.minute);
}
