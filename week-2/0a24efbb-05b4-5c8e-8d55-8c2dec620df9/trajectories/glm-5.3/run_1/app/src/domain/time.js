import { ApiError, errors } from './errors.js';

export const TIME_ZONE = 'Europe/London';

const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const partsCached = new Map();
function dateParts(date) {
  const key = date.getTime();
  let p = partsCached.get(key);
  if (!p) {
    p = {};
    for (const part of dayFormatter.formatToParts(date)) p[part.type] = part.value;
    partsCached.set(key, p);
    if (partsCached.size > 10000) partsCached.clear();
  }
  return p;
}

/** The London date and clock parts of an instant: year, month, day, hour, minute. */
function clockParts(date) {
  const p = {};
  for (const part of clockFormatter.formatToParts(date)) p[part.type] = part.value;
  return p;
}

/** The London business date of an instant, as YYYY-MM-DD. */
export function businessDay(date) {
  const p = dateParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** The London business month of an instant, as YYYY-MM. */
export function businessMonth(date) {
  const p = dateParts(date);
  return `${p.year}-${p.month}`;
}

export function parseDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const y = Number(day.slice(0, 4));
  const mo = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  if (mo < 1 || mo > 12) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { year: y, month: mo, day: d };
}

export function isValidDay(day) {
  return parseDay(day) !== null;
}

export function isValidMonth(month) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return false;
  return parseDay(`${month}-01`) !== null;
}

export function dayToUtcDate(day) {
  const { year, month, day: d } = parseDay(day);
  return new Date(Date.UTC(year, month - 1, d));
}

export function addDays(day, n) {
  const dt = dayToUtcDate(day);
  dt.setUTCDate(dt.getUTCDate() + n);
  return businessDayOfUtc(dt);
}

export function businessDayOfUtc(dt) {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function dayDiff(a, b) {
  // whole calendar days a - b
  return Math.round((dayToUtcDate(a).getTime() - dayToUtcDate(b).getTime()) / 86400000);
}

const offsetZoneMs = (() => {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return function zoneMs(date) {
    const p = {};
    for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
    return asUtc - date.getTime();
  };
})();

function offsetMsForDay(day, hour) {
  const probe = new Date(dayToUtcDate(day).getTime() + hour * 3600000);
  return offsetZoneMs(probe);
}

export function parseTime(hhmm) {
  if (typeof hhmm !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return null;
  return { hour: Number(hhmm.slice(0, 2)), minute: Number(hhmm.slice(3, 5)) };
}

/**
 * The instant of a claimed HH:MM on a business day in Kestrel Works time.
 * Returns null when that wall-clock time never occurs that day.
 * A time occurring twice (clocks went back) resolves to the earlier instant.
 */
export function claimedInstant(day, hhmm) {
  const t = parseTime(hhmm);
  if (!t) return null;
  const { hour, minute } = t;
  const ms = dayToUtcDate(day).getTime();
  // London is at most 2 hours ahead of UTC; the candidate offsets across a
  // day are at most +2 and at least -1 around a changeover.
  const candidates = new Set([
    offsetMsForDay(day, 0),
    offsetMsForDay(day, 12),
    offsetMsForDay(day, 23),
  ]);
  const matches = [];
  for (const off of candidates) {
    const inst = ms + hour * 3600000 + minute * 60000 - off;
    if (businessDay(new Date(inst)) === day) {
      const p = clockParts(new Date(inst));
      const h = Number(p.hour) % 24;
      if (h === hour && Number(p.minute) === minute) matches.push(inst);
    }
  }
  if (matches.length === 0) return null;
  return Math.min(...matches);
}

/** Does this wall-clock time occur on this business day at all? */
export function timeOccursOnDay(day, hhmm) {
  return claimedInstant(day, hhmm) !== null;
}

/** The next business day after `day`. */
export function nextBusinessDay(day) {
  return addDays(day, 1);
}

/** The previous business day before `day`. */
export function previousBusinessDay(day) {
  return addDays(day, -1);
}

export function monthOf(day) {
  return day.slice(0, 7);
}

export function firstDayOfMonth(month) {
  return `${month}-01`;
}

export function daysInMonth(month) {
  const { year, month: mo } = parseDay(`${month}-01`);
  return new Date(Date.UTC(year, mo, 0)).getUTCDate();
}

export function addMonths(month, n) {
  const { year, month: mo } = parseDay(`${month}-01`);
  const d = new Date(Date.UTC(year, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function formatTimestamp(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function parseTimestamp(ts) {
  return new Date(ts);
}

/** Format an instant as HH:MM in London, or null. */
export function instantToWallClock(date) {
  if (!date) return null;
  const p = clockParts(date);
  const h = Number(p.hour) % 24;
  return `${String(h).padStart(2, '0')}:${p.minute}`;
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function monthName(month) {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1];
}

/** Monday-based weekday index of a business day. */
export function weekdayIndex(day) {
  return (dayToUtcDate(day).getUTCDay() + 6) % 7;
}

/** Business dates of every day of a month, in order. */
export function daysOfMonth(month) {
  const n = daysInMonth(month);
  const out = [];
  for (let i = 1; i <= n; i++) out.push(`${month}-${String(i).padStart(2, '0')}`);
  return out;
}

/** Ids, days and months are checked against these helpers. */

export function isRequestIdSegment(segment) {
  if (!/^[1-9][0-9]*$/.test(segment)) return false;
  if (segment.length > 19) return false;
  // compared as a string, since 2^63-1 is not exact as a JS number
  if (segment.length === 19) return segment <= '9223372036854775807';
  return true;
}

export function assertNulFree(field, value) {
  if (typeof value === 'string' && value.includes('\u0000')) {
    throw errors.nulCharacter(field);
  }
}

export function requireString(field, value) {
  if (value === undefined || value === null) throw errors.signInRequired(field);
  if (typeof value !== 'string') {
    throw new ApiError(400, `${field} must be text.`, { field });
  }
  return value;
}
