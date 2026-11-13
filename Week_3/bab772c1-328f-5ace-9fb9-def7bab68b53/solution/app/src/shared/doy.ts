/** GMT day-of-year times: `YYYY-DDD/HH:MM:SS`, never touched by a browser time zone. */

const DOY_PATTERN = /^(\d{4})-(\d{3})\/(\d{2}):(\d{2}):(\d{2})$/;
const DAY_MS = 86_400_000;

function utcMillis(year: number, month: number, day: number, hours = 0, minutes = 0, seconds = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(hours, minutes, seconds, 0);
  return date.getTime();
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

/** Parses a day-of-year time to Unix milliseconds, or null when malformed. */
export function parseDoyToMs(text: string): number | null {
  const match = DOY_PATTERN.exec(text);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const dayOfYear = Number(match[2]);
  const hours = Number(match[3]);
  const minutes = Number(match[4]);
  const seconds = Number(match[5]);
  if (dayOfYear < 1 || dayOfYear > daysInYear(year)) {
    return null;
  }
  if (hours > 23 || minutes > 59 || seconds > 59) {
    return null;
  }
  const startOfYear = utcMillis(year, 0, 1);
  return (
    startOfYear + (dayOfYear - 1) * DAY_MS + ((hours * 60 + minutes) * 60 + seconds) * 1000
  );
}

/** Formats Unix milliseconds as a GMT day-of-year time. */
export function formatDoy(unixMs: number): string {
  const date = new Date(Math.floor(unixMs / 1000) * 1000);
  const year = date.getUTCFullYear();
  const startOfYear = utcMillis(year, 0, 1);
  const dayOfYear =
    Math.floor((unixMs - startOfYear) / DAY_MS) + 1;
  const pad = (value: number, width: number): string => String(value).padStart(width, "0");
  return `${pad(year, 4)}-${pad(dayOfYear, 3)}/${pad(date.getUTCHours(), 2)}:${pad(
    date.getUTCMinutes(),
    2,
  )}:${pad(date.getUTCSeconds(), 2)}`;
}

/** Parses a day-of-year time to an ISO instant, or null when malformed. */
export function parseDoyToIso(text: string): string | null {
  const ms = parseDoyToMs(text);
  return ms === null ? null : isoInstant(ms);
}

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

/** Formats Unix milliseconds as `YYYY-MM-DDTHH:MM:SSZ`. */
export function isoInstant(unixMs: number): string {
  return `${new Date(Math.floor(unixMs / 1000) * 1000).toISOString().slice(0, 19)}Z`;
}

/** Parses an ISO instant (`YYYY-MM-DDTHH:MM:SSZ` exactly) to Unix milliseconds. */
export function parseIsoInstant(text: string): number | null {
  const match = ISO_PATTERN.exec(text);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  const seconds = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hours > 23 || minutes > 59 || seconds > 59) {
    return null;
  }
  const ms = utcMillis(year, month - 1, day, hours, minutes, seconds);
  const back = new Date(ms);
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) {
    return null;
  }
  return ms;
}

