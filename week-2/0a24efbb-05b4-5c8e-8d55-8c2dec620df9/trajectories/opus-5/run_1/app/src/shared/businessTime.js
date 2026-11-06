import { TIME_ZONE } from './constants.js';

const DAY_MS = 86400000;

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SHORT_MONTH_NAMES = MONTH_NAMES.map((m) => m.slice(0, 3));

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_PATTERN = /^\d{4}-\d{2}$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function wallParts(instantMs) {
  const parts = {};
  for (const { type, value } of partsFormatter.formatToParts(new Date(instantMs))) {
    if (type !== 'literal') parts[type] = value;
  }
  return parts;
}

/** The wall-clock reading in business time, expressed as a UTC-based millisecond count. */
function wallMs(instantMs) {
  const p = wallParts(instantMs);
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
}

function civilMs(day, hour, minute) {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d, hour, minute, 0);
}

/** True when the string is a real calendar date written YYYY-MM-DD. */
export function isBusinessDay(value) {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** True when the string is a real year and month written YYYY-MM. */
export function isBusinessMonth(value) {
  if (typeof value !== 'string' || !MONTH_PATTERN.test(value)) return false;
  const m = Number(value.slice(5, 7));
  return m >= 1 && m <= 12;
}

export function isClaimTime(value) {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

/** Every instant in business time that reads the given wall clock, earliest first. */
function instantsFor(day, hhmm) {
  const [hour, minute] = hhmm.split(':').map(Number);
  const target = civilMs(day, hour, minute);
  const found = new Set();
  for (const probe of [target, target - 3 * DAY_MS, target + 3 * DAY_MS]) {
    const guess = target - (wallMs(probe) - probe);
    if (wallMs(guess) === target) found.add(guess);
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * The UTC instant of a business wall-clock time, or null when that time does not
 * occur on that business day. A time that occurs twice resolves to the earlier instant.
 */
export function businessInstant(day, hhmm) {
  const candidates = instantsFor(day, hhmm);
  return candidates.length === 0 ? null : new Date(candidates[0]);
}

/** The business date of an instant, written YYYY-MM-DD. */
export function businessDay(instant) {
  const p = wallParts(instant instanceof Date ? instant.getTime() : new Date(instant).getTime());
  return `${p.year}-${p.month}-${p.day}`;
}

/** The business wall-clock time of an instant, written HH:MM. */
export function businessTimeOfDay(instant) {
  const p = wallParts(instant instanceof Date ? instant.getTime() : new Date(instant).getTime());
  return `${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}`;
}

/** Today's business date. */
export function businessToday(now = new Date()) {
  return businessDay(now);
}

export function addDays(day, count) {
  const [y, m, d] = day.split('-').map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + count));
  return isoDate(moved);
}

export function daysBetween(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS);
}

function isoDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function dayOfMonth(day) {
  return Number(day.slice(8, 10));
}

export function monthOf(day) {
  return day.slice(0, 7);
}

export function firstDayOfMonth(month) {
  return `${month}-01`;
}

export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthDays(month) {
  const total = daysInMonth(month);
  const out = [];
  for (let d = 1; d <= total; d += 1) out.push(`${month}-${String(d).padStart(2, '0')}`);
  return out;
}

export function addMonths(month, count) {
  const [y, m] = month.split('-').map(Number);
  const moved = new Date(Date.UTC(y, m - 1 + count, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthName(month) {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1];
}

export function shortMonthName(day) {
  return SHORT_MONTH_NAMES[Number(day.slice(5, 7)) - 1];
}

export function monthTitle(month) {
  return `${monthName(month)} ${month.slice(0, 4)}`;
}

/** Day of the week as 0 for Monday through 6 for Sunday. */
export function weekdayIndex(day) {
  const [y, m, d] = day.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** A UTC timestamp to the whole second, ending in Z. */
export function utcSeconds(instant) {
  if (instant === null || instant === undefined) return null;
  const date = instant instanceof Date ? instant : new Date(instant);
  return `${date.toISOString().slice(0, 19)}Z`;
}

export function truncateToSecond(instant) {
  const date = instant instanceof Date ? instant : new Date(instant);
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

/** A business date and time written YYYY-MM-DD HH:MM. */
export function businessStamp(instant) {
  return `${businessDay(instant)} ${businessTimeOfDay(instant)}`;
}
