// One place for every time and calendar fact. Public-facing text on the
// server and browser share these helpers so a copy is computed identically.
export const ZONE = 'America/Chicago';
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The household offset in minutes at instant t. Negative is west. */
export function offsetAt(t: number): number {
  // DST transitions in America/Chicago: spring forward at 02:00 CST
  // (08:00Z), fall back at 02:00 CDT (07:00Z).
  const spring2026 = Date.UTC(2026, 2, 8, 8);
  const fall2026 = Date.UTC(2026, 10, 1, 7);
  const spring2027 = Date.UTC(2027, 2, 14, 8);
  const fall2027 = Date.UTC(2027, 10, 7, 7);
  const dst = (t >= spring2026 && t < fall2026) || (t >= spring2027 && t < fall2027);
  return dst ? -300 : -360;
}

export function fmtOffset(o: number): string {
  const sign = o < 0 ? '-' : '+';
  const a = Math.abs(o);
  return `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Convert a UTC instant to household local wall-clock parts. */
export function localParts(t: number): { y: number; mo: number; d: number; h: number; mi: number; s: number; off: number } {
  const off = offsetAt(t);
  const d = new Date(t + off * 60_000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), off };
}

export function dayOf(t: number): string {
  const p = localParts(t);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

/** The UTC instant of household midnight starting the given day. */
export function dayStartUTC(day: string): number {
  const [y, mo, d] = day.split('-').map(Number);
  // Try candidate offsets (there is at most one DST change per midnight).
  for (const off of [-360, -300]) {
    const t = Date.UTC(y, mo - 1, d, 0, 0, 0) - off * 60_000;
    if (offsetAt(t) === off) return t;
  }
  return Date.UTC(y, mo - 1, d, 0, 0, 0) - offsetAt(Date.UTC(y, mo - 1, d, 12)) * 60_000;
}

/** The UTC instant of household midnight that ends the given day. */
export function dayEndUTC(day: string): number {
  return dayStartUTC(addDays(day, 1));
}

/** Day length in whole hours: 23, 24 or 25. */
export function dayHours(day: string): number {
  const start = dayStartUTC(day);
  const end = dayEndUTC(day);
  return Math.round((end - start) / 3_600_000);
}

/** Whether this day is the fall-back day (25 hours). */
export function isFallBack(day: string): boolean {
  return dayHours(day) === 25;
}

/** Whether this day is the spring-forward day (23 hours). */
export function isSpringForward(day: string): boolean {
  return dayHours(day) === 23;
}

export function addDays(day: string, n: number): string {
  const [y, mo, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function validDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, mo, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Weekday name of a household day. */
export function weekdayOf(day: string): string {
  const [y, mo, d] = day.split('-').map(Number);
  const idx = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return WEEKDAYS[idx === 0 ? 6 : idx - 1];
}

export function weekdayShortOf(day: string): string {
  const [y, mo, d] = day.split('-').map(Number);
  const idx = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return WEEKDAYS_SHORT[idx === 0 ? 6 : idx - 1];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Sunday 1 November 2026" */
export function longDate(day: string): string {
  const [y, mo, d] = day.split('-').map(Number);
  return `${weekdayOf(day)} ${d} ${MONTHS[mo - 1]} ${y}`;
}

/** "CDT" or "CST" for an offset. */
export function abbrOf(off: number): string {
  return off === -300 ? 'CDT' : 'CST';
}

/** ISO-8601 with seconds and the household offset at that instant. */
export function isoOf(t: number): string {
  const p = localParts(t);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}${fmtOffset(p.off)}`;
}

/** Parse an ISO-8601 instant that must carry an offset. Returns epoch ms, or null. */
export function parseISO(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/.exec(s);
  if (!m) return null;
  const off = m[7] === 'Z' ? 0 : (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(4, 6))) * (m[7][0] === '-' ? -1 : 1);
  const [y, mo, d, h, mi, sec] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])];
  const t = Date.UTC(y, mo - 1, d, h, mi, sec) - off * 60_000;
  // The offset must hold at that instant, so the wall clock reads back.
  const chk = new Date(t + off * 60_000);
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d || chk.getUTCHours() !== h || chk.getUTCMinutes() !== mi || chk.getUTCSeconds() !== sec) return null;
  return t;
}

/** Parse "YYYY-MM-DDTHH:MM" household wall time. Returns epoch ms, or "skipped" if the wall time does not exist. */
export function parseWall(dayTime: string): number | 'skipped' | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(dayTime);
  if (!m) return null;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  if (!validDay(day)) return null;
  const hh = Number(m[4]), mm = Number(m[5]);
  if (hh > 23 || mm > 59) return null;
  return wallToInstant(day, hh, mm);
}

/**
 * The one place that decides slot occurrence instants across daylight-saving
 * changes.
 * - A wall time in the repeated hour resolves to its first occurrence.
 * - A wall time in the skipped hour resolves to the day's 03:00 instant.
 * - Any other wall time resolves to the single instant it names.
 */
export function wallToInstant(day: string, hh: number, mm: number): number | 'skipped' {
  const start = dayStartUTC(day);
  // Candidate: this wall time with the offset in force at the day's start.
  const offStart = offsetAt(start);
  const t1 = Date.UTC(...dayParts(day), hh, mm) - offStart * 60_000;
  if (offsetAt(t1) === offStart) return t1;
  // Offset changed mid-day; the wall time may fall before or after the change.
  const end = dayEndUTC(day);
  const offEnd = offsetAt(end - 1);
  if (offEnd === offStart) return t1;
  const t2 = Date.UTC(...(dayParts(day) as [number, number, number]), hh, mm) - offEnd * 60_000;
  if (offsetAt(t2) === offEnd) return t2;
  // Neither offset produces this wall time: it is the skipped hour (spring
  // forward) — resolve to the day's 03:00.
  return 'skipped';
}

function dayParts(day: string): [number, number, number] {
  const [y, mo, d] = day.split('-').map(Number);
  return [y, mo - 1, d];
}

/**
 * For a UTC instant on a fall-back day inside the repeated hour, whether it is
 * the first pass of that local hour.
 */
export function isFirstPass(t: number): boolean {
  const p = localParts(t);
  if (p.h !== 1) return true;
  const start = dayStartUTC(dayOf(t));
  const off = offsetAt(t);
  const wallMid = Date.UTC(p.y, p.mo - 1, p.d, 1, p.mi, p.s) - offsetAt(start) * 60_000;
  return t === wallMid && offsetAt(start) === off;
}

/** Minutes since household midnight for an instant, on days of any length. */
export function minutesIntoDay(t: number): number {
  const p = localParts(t);
  return p.h * 60 + p.mi;
}

/** Local wall time parts of an instant, with the abbreviation when ambiguous. */
export function wallOf(t: number): { day: string; hh: number; mm: number; off: number; abbr: string; repeated: boolean } {
  const p = localParts(t);
  const repeated = isRepeatedInstant(t);
  return { day: dayOf(t), hh: p.h, mm: p.mi, off: p.off, abbr: abbrOf(p.off), repeated };
}

/** Whether an instant sits inside a repeated local hour. */
export function isRepeatedInstant(t: number): boolean {
  const p = localParts(t);
  if (p.h !== 1) return false;
  const start = dayStartUTC(dayOf(t));
  if (!isFallBack(dayOf(t))) return false;
  const second = Date.UTC(p.y, p.mo - 1, p.d, 1, 0, 0) - offsetAt(start + 2 * 3_600_000) * 60_000;
  return t >= second && t < second + 3_600_000;
}
