'use strict';

// New York calendar arithmetic. Every wall-clock instant is resolved on its own
// date by that date's own daylight-saving rule, never by adding 24 hours.

const ZONE = 'America/New_York';
const DAY_MS = 86400000;

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function nyParts(instant) {
  const ms = instant instanceof Date ? instant.getTime() : Number(instant);
  const out = {};
  for (const part of partsFormat.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  const hour = out.hour === '24' ? 0 : Number(out.hour);
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour,
    minute: Number(out.minute),
    second: Number(out.second),
    ms: ms - Math.floor(ms / 1000) * 1000,
  };
}

function pad(n, width) {
  return String(n).padStart(width, '0');
}

// The New York calendar date of an instant, as YYYY-MM-DD.
function nyDate(instant) {
  const p = nyParts(instant);
  return `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}`;
}

// Milliseconds since New York midnight on the instant's own date.
function nyMsOfDay(instant) {
  const p = nyParts(instant);
  return ((p.hour * 60 + p.minute) * 60 + p.second) * 1000 + p.ms;
}

function zoneOffsetMs(instantMs) {
  const p = nyParts(instantMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

// The UTC instant of a New York wall-clock time, resolved by that date's rule.
function nyWallToUtc(dateStr, hour = 0, minute = 0, second = 0, msec = 0) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, hour, minute, second, msec);
  let offset = zoneOffsetMs(wallAsUtc + 5 * 3600000);
  let candidate = wallAsUtc - offset;
  const check = zoneOffsetMs(candidate);
  if (check !== offset) candidate = wallAsUtc - check;
  return candidate;
}

// The UTC instant of 00:00 New York time on a date.
function nyMidnightUtc(dateStr) {
  return nyWallToUtc(dateStr, 0, 0, 0, 0);
}

// The exclusive upper bound of a New York calendar day: the next day's midnight.
function nyDayEndExclusiveUtc(dateStr) {
  return nyMidnightUtc(addDays(dateStr, 1));
}

function isDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

function isMonthString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false;
  const m = Number(value.slice(5, 7));
  return m >= 1 && m <= 12;
}

// Calendar-date arithmetic, never 24-hour steps.
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * DAY_MS;
  const dt = new Date(t);
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1, 2)}-${pad(dt.getUTCDate(), 2)}`;
}

function dayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function compareDates(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const first = `${pad(y, 4)}-${pad(m, 2)}-01`;
  const nextMonth = m === 12 ? `${pad(y + 1, 4)}-01-01` : `${pad(y, 4)}-${pad(m + 1, 2)}-01`;
  return { first, nextFirst: nextMonth, lastOfPrevious: addDays(first, -1) };
}

function monthOf(dateStr) {
  return dateStr.slice(0, 7);
}

function addMonths(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${pad(Math.floor(total / 12), 4)}-${pad((total % 12) + 1, 2)}`;
}

module.exports = {
  ZONE,
  nyParts,
  nyDate,
  nyMsOfDay,
  nyWallToUtc,
  nyMidnightUtc,
  nyDayEndExclusiveUtc,
  isDateString,
  isMonthString,
  addDays,
  dayOfWeek,
  compareDates,
  monthBounds,
  monthOf,
  addMonths,
};
