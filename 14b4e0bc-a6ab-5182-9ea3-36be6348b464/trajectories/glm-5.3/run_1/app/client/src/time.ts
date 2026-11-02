/** The viewer-zone time format: `YYYY-MM-DD HH:mm:ss.sss UTC±HH:MM` (DP-51). */
export function formatViewerZone(at: string): string {
  const inst = Date.parse(at.endsWith('Z') ? at : `${at}Z`);
  if (Number.isNaN(inst)) return at;
  const date = new Date(inst);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  let h = get('hour');
  if (h === '24') h = '00';
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
  const offset = offsetMinutes(date, tz);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${get('year')}-${get('month')}-${get('day')} ${h}:${get('minute')}:${get('second')}.${ms} UTC${sign}${String(
    Math.floor(abs / 60)
  ).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function offsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUTC - date.getTime()) / 60000);
}

/**
 * America/Chicago business time conversion (DP-88): the earlier offset in the
 * repeated fall-back hour, a skipped spring-forward time shifted forward.
 */
export function chicagoInstantFromWallTime(wall: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(wall);
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
  const offset = (ms: number): number => chicagoOffsetSeconds(ms);
  const dst = naive + 5 * 3_600_000;
  const std = naive + 6 * 3_600_000;
  if (offset(dst) === -5 * 3600) return rfc3339(dst, -5 * 60);
  if (offset(std) === -6 * 3600) return rfc3339(std, -6 * 60);
  const shiftedDst = naive + 3_600_000 + 5 * 3_600_000;
  const shiftedStd = naive + 3_600_000 + 6 * 3_600_000;
  if (offset(shiftedDst) === -5 * 3600) return rfc3339(shiftedDst, -5 * 60);
  if (offset(shiftedStd) === -6 * 3600) return rfc3339(shiftedStd, -6 * 60);
  return rfc3339(std, -6 * 60);
}

function rfc3339(ms: number, offsetMinutes: number): string {
  const date = new Date(ms - offsetMinutes * 60_000);
  const p = (n: number): string => String(n).padStart(2, '0');
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}T${p(date.getUTCHours())}:${p(
    date.getUTCMinutes()
  )}:${p(date.getUTCSeconds())}${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
}

/** America/Chicago offsets: -06:00 standard, -05:00 daylight, by the 2007 rules. */
export function chicagoOffsetSeconds(instantMs: number): number {
  const year = new Date(instantMs).getUTCFullYear();
  const dstStart = Date.UTC(year, 2, nthSunday(year, 2, 2), 2, 0, 0) + 6 * 3_600_000;
  const dstEnd = Date.UTC(year, 10, nthSunday(year, 10, 1), 2, 0, 0) + 5 * 3_600_000;
  if (instantMs >= dstStart && instantMs < dstEnd) return -5 * 3600;
  return -6 * 3600;
}

function nthSunday(year: number, month: number, nth: number): number {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + nth * 7;
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
