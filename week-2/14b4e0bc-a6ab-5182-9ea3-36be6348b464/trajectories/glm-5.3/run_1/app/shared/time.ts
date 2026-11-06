const CHICAGO_ZONE = 'America/Chicago';

export function timestampAt(at: Date): string {
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}T${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}.${String(at.getUTCMilliseconds()).padStart(3, '0')}Z`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export interface ZoneTransition {
  from: number; // seconds east of UTC before the transition
  to: number; // seconds east of UTC from the transition instant
  at: number; // ms since epoch
}

/**
 * America/Chicago rules 2007..2100 (DST from the second Sunday in March 02:00 local
 * to the first Sunday in November 02:00 local; -06:00 standard, -05:00 daylight).
 */
export function chicagoOffsetSeconds(instantMs: number): number {
  // Standard time -06:00 (America/Chicago has had these rules since 2007; no future change is scheduled).
  const year = new Date(instantMs).getUTCFullYear();
  const marchStart = Date.UTC(year, 2, 1);
  const secondSundayMarch = Date.UTC(year, 2, sundayOf(2, year, 2), 2, 0, 0) + 6 * 3600_000; // 02:00 local = 08:00Z (std)
  const firstSundayNov = Date.UTC(year, 10, sundayOf(0, year, 10), 2, 0, 0) + 5 * 3600_000; // 02:00 local = 07:00Z (dst)
  void marchStart;
  if (instantMs >= secondSundayMarch && instantMs < firstSundayNov) return -5 * 3600;
  return -6 * 3600;
}

function sundayOf(nth: number, year: number, month: number): number {
  // day-of-month of the nth Sunday of the month (0-based month)
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + nth * 7;
}

/**
 * Converts an America/Chicago wall time to an instant, taking the earlier offset in
 * the repeated fall-back hour and shifting a skipped spring-forward time forward (DP-88).
 */
export function chicagoWallTimeToInstant(date: string, time: string): { instantMs: number; offsetSeconds: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(date && time ? `${date}T${time}` : '');
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const daysIn = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > daysIn[month - 1]!) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  // Try DST (-05:00) then standard (-06:00). In the repeated hour the earlier
  // (DST) offset is taken; for a gap, the wall time does not exist with -06:00.
  const dst = naive + 5 * 3600_000;
  const std = naive + 6 * 3600_000;
  const isDst = (ms: number) => chicagoOffsetSeconds(ms) === -5 * 3600;
  if (isDst(dst)) return { instantMs: dst, offsetSeconds: -5 * 3600 };
  if (isDst(std)) return { instantMs: std, offsetSeconds: -6 * 3600 };
  // Skipped hour: shift forward by the gap length (one hour).
  const shifted = naive + 3600_000;
  const shiftedDst = shifted + 5 * 3600_000;
  if (isDst(shiftedDst)) return { instantMs: shiftedDst, offsetSeconds: -5 * 3600 };
  const shiftedStd = shifted + 6 * 3600_000;
  if (isDst(shiftedStd)) return { instantMs: shiftedStd, offsetSeconds: -6 * 3600 };
  return { instantMs: std, offsetSeconds: -6 * 3600 };
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Viewer-zone time: `YYYY-MM-DD HH:mm:ss.sss UTC±HH:MM` in the browser's zone at that instant. */
export function formatViewerZone(at: string, timeZone: string): string {
  const inst = Date.parse(at.endsWith('Z') ? at : at + 'Z');
  if (Number.isNaN(inst)) return at;
  const dt = new Date(inst);
  const parts = dateTimeParts(dt, timeZone);
  if (!parts) return at;
  const offsetMinutes = parts.offsetMinutes;
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${parts.y}-${parts.mo}-${parts.d} ${parts.h}:${parts.mi}:${parts.s}.${parts.ms} UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

interface DtParts {
  y: string;
  mo: string;
  d: string;
  h: string;
  mi: string;
  s: string;
  ms: string;
  offsetMinutes: number;
}

export function dateTimeParts(date: Date, timeZone: string): DtParts | null {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  const y = get('year');
  const mo = get('month');
  const d = get('day');
  let h = get('hour');
  if (h === '24') h = '00';
  const mi = get('minute');
  const s = get('second');
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
  const offsetMinutes = zoneOffsetMinutes(date, timeZone);
  if (!y || !mo || !d) return null;
  return { y, mo, d, h, mi, s, ms, offsetMinutes };
}

export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const parts = dtf.formatToParts(date);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUTC - date.getTime()) / 60000);
}

export const BUSINESS_ZONE = CHICAGO_ZONE;
