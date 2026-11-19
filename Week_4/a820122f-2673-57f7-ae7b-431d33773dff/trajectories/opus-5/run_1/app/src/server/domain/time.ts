export const MINUTE_MS = 60_000;
export const HALF_HOUR_MS = 30 * MINUTE_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

const INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
const SHIP_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const CLOCK_PATTERN = /^(\d{2}):(\d{2})$/;

function two(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Parses a UTC instant of the form YYYY-MM-DDTHH:MM:SSZ, returning epoch milliseconds. */
export function parseInstant(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const match = INSTANT_PATTERN.exec(text);
  if (match === null) return null;
  const [, y, mo, d, h, mi, s] = match;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (formatInstant(ms) !== text) return null;
  return ms;
}

export function formatInstant(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}` +
    `T${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}Z`
  );
}

export function isAligned(ms: number): boolean {
  return ms % HALF_HOUR_MS === 0;
}

/** Parses a ship's date of the form YYYY-MM-DD, returning the epoch milliseconds of its local midnight. */
export function parseShipDate(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const match = SHIP_DATE_PATTERN.exec(text);
  if (match === null) return null;
  const [, y, mo, d] = match;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  if (formatShipDate(ms) !== text) return null;
  return ms;
}

export function formatShipDate(localMidnightMs: number): string {
  const d = new Date(localMidnightMs);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
}

export function shipDateOfLocalMs(localMs: number): string {
  return formatShipDate(Math.floor(localMs / DAY_MS) * DAY_MS);
}

export function addShipDays(shipDate: string, days: number): string {
  const base = parseShipDate(shipDate);
  if (base === null) throw new Error(`Not a ship's date: ${shipDate}`);
  return formatShipDate(base + days * DAY_MS);
}

export function shipDateRange(from: string, to: string): string[] {
  const start = parseShipDate(from);
  const end = parseShipDate(to);
  if (start === null || end === null) throw new Error("Not a ship's date range");
  const dates: string[] = [];
  for (let ms = start; ms <= end; ms += DAY_MS) dates.push(formatShipDate(ms));
  return dates;
}

export function monthOfShipDate(shipDate: string): string {
  return shipDate.slice(0, 7);
}

export function isMonth(text: unknown): text is string {
  if (typeof text !== 'string') return false;
  const match = MONTH_PATTERN.exec(text);
  if (match === null) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

export function monthShipDates(month: string): { first: string; last: string } {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const first = formatShipDate(Date.UTC(year, monthNumber - 1, 1));
  const last = formatShipDate(Date.UTC(year, monthNumber, 1) - DAY_MS);
  return { first, last };
}

/** Parses an HH:MM clock reading, returning minutes after midnight. */
export function parseClockTime(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const match = CLOCK_PATTERN.exec(text);
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatClockTime(minutesAfterMidnight: number): string {
  const total = ((minutesAfterMidnight % 1440) + 1440) % 1440;
  return `${two(Math.floor(total / 60))}:${two(total % 60)}`;
}

/** Formats a ship-time string of the form YYYY-MM-DD HH:MM from a local reading. */
export function formatShipTime(localMs: number): string {
  const d = new Date(localMs);
  return (
    `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}` +
    ` ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`
  );
}

export function oneDecimal(value: number): string {
  return value.toFixed(1);
}
