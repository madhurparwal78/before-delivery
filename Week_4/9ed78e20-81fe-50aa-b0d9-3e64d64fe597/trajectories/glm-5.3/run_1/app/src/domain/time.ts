/**
 * Europe/London wall-clock conversion without external time-zone data.
 * Britain changes clocks on the last Sunday of March (forward, 01:00) and the
 * last Sunday of October (back, 02:00). GMT is +00:00 and BST is +01:00.
 */
export const LONDON_TZ = 'Europe/London';

export function lastSundayOfMonth(year: number, month: number): Date {
  // month is 1-based; find the last day of the month, step back to Sunday (UTC).
  const lastDay = new Date(Date.UTC(year, month, 0));
  const day = lastDay.getUTCDay();
  lastDay.setUTCDate(lastDay.getUTCDate() - day);
  return lastDay;
}

export type LondonOffset = -1 | 0;

/** Offset of London local time at a given instant, in minutes. */
export function londonOffsetMinutes(instant: Date): number {
  const year = instant.getUTCFullYear();
  const start = lastSundayOfMonth(year, 3); // last Sunday of March
  const startOfChange = Date.UTC(year, start.getUTCMonth(), start.getUTCDate(), 1, 0, 0);
  const end = lastSundayOfMonth(year, 10);
  // Clocks go back at 02:00 BST = 01:00 UTC
  const endOfChange = Date.UTC(year, end.getUTCMonth(), end.getUTCDate(), 1, 0, 0);
  const t = instant.getTime();
  return t >= startOfChange && t < endOfChange ? 60 : 0;
}

export type LondonParseResult =
  | { ok: true; instant: Date; offsetMinutes: number }
  | { ok: false; reason: 'nonexistent' | 'malformed' };

/**
 * Parse a wall-clock time in Europe/London into an instant. The earlier
 * occurrence wins when the clocks go back; a time skipped by the clocks going
 * forward is reported as nonexistent.
 */
export function parseLondonTime(value: string, now = new Date()): LondonParseResult {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) return { ok: false, reason: 'malformed' };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] !== undefined ? Number(m[6]) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return { ok: false, reason: 'malformed' };
  }
  if (month === 2 && day > 29) return { ok: false, reason: 'malformed' };
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return { ok: false, reason: 'malformed' };

  const wallStartUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const year0 = new Date(wallStartUtc).getUTCFullYear();
  const marchSun = lastSundayOfMonth(year0, 3);
  const startOfChange = Date.UTC(year0, marchSun.getUTCMonth(), marchSun.getUTCDate(), 1, 0, 0);
  const octSun = lastSundayOfMonth(year0, 10);
  const endOfChange = Date.UTC(year0, octSun.getUTCMonth(), octSun.getUTCDate(), 1, 0, 0);

  if (wallStartUtc >= startOfChange && wallStartUtc < endOfChange) {
    // The wall clock is inside the possible forward-change hour.
    const changeHourLocal = 1;
    const wallHour = hour;
    if (wallHour === changeHourLocal && year0 === new Date(startOfChange).getUTCFullYear()) {
      // 01:00-01:59 on the change day does not exist (01:xx -> 02:xx).
      const changeDayUtc = startOfChange;
      if (wallStartUtc >= changeDayUtc && wallStartUtc < changeDayUtc + 3600 * 1000) {
        return { ok: false, reason: 'nonexistent' };
      }
    }
    return { ok: true, instant: new Date(wallStartUtc - 3600 * 1000), offsetMinutes: 60 };
  }
  if (wallStartUtc >= endOfChange && wallStartUtc < endOfChange + 3600 * 1000) {
    // The repeated hour when clocks go back: take the earlier (BST) occurrence.
    return { ok: true, instant: new Date(wallStartUtc - 3600 * 1000), offsetMinutes: 60 };
  }
  return { ok: true, instant: new Date(wallStartUtc), offsetMinutes: 0 };
}

export function isFutureInstant(instant: Date, now = new Date()): boolean {
  return instant.getTime() > now.getTime();
}

/** Format an instant in London time as D Month YYYY, HH:mm. */
export function formatLondon(instant: Date): string {
  const offset = londonOffsetMinutes(instant) * 60000;
  const local = new Date(instant.getTime() + offset);
  const day = local.getUTCDate();
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const month = months[local.getUTCMonth()];
  const year = local.getUTCFullYear();
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hh}:${mm}`;
}

/** Today's date in London as YYYY-MM-DD. */
export function londonToday(now = new Date()): string {
  const offset = londonOffsetMinutes(now) * 60000;
  const local = new Date(now.getTime() + offset);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(
    local.getUTCDate(),
  ).padStart(2, '0')}`;
}

export function isValidDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth && year >= 1;
}

/** Parse an ISO instant strictly in the form YYYY-MM-DDTHH:mm:ssZ. */
export function parseStrictInstant(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(value);
  if (!m) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (d.toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return d;
}
