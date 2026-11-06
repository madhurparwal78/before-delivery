/** Asia/Kolkata is a fixed +05:30 offset with no daylight saving. */
export const IST_OFFSET_MINUTES = 330;
const MINUTE = 60_000;
const DAY = 86_400_000;

export interface IstParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

export function istParts(epochMs: number): IstParts {
  const shifted = new Date(epochMs + IST_OFFSET_MINUTES * MINUTE);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/** `YYYY-MM-DDTHH:MM:SS+05:30` */
export function istTimestamp(epochMs: number): string {
  const p = istParts(epochMs);
  return `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}`
    + `T${pad(p.hour, 2)}:${pad(p.minute, 2)}:${pad(p.second, 2)}+05:30`;
}

/** `YYYY-MM-DD` of the IST calendar date. */
export function istDateString(epochMs: number): string {
  const p = istParts(epochMs);
  return `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}`;
}

/** Epoch ms of midnight IST on an IST calendar date given as `YYYY-MM-DD`. */
export function istMidnight(date: string): number {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  return Date.UTC(year, month - 1, day) - IST_OFFSET_MINUTES * MINUTE;
}

/** Epoch ms of `HH:MM` IST, `dayOffset` days after the IST date `date`. */
export function istAt(date: string, time: string, dayOffset = 0): number {
  const [hour, minute] = time.split(':').map((part) => Number.parseInt(part, 10));
  return istMidnight(date) + dayOffset * DAY + (hour * 60 + minute) * MINUTE;
}

export function addDaysToDate(date: string, days: number): string {
  return istDateString(istMidnight(date) + days * DAY);
}

export function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return istDateString(istMidnight(value)) === value;
}

/** `HH:MM` in IST. */
export function istHourMinute(epochMs: number): string {
  const p = istParts(epochMs);
  return `${pad(p.hour, 2)}:${pad(p.minute, 2)}`;
}

/** `02 DEC 2026` — the availability-label date form. */
export function istLabelDate(epochMs: number): string {
  const p = istParts(epochMs);
  return `${pad(p.day, 2)} ${MONTH_NAMES[p.month - 1].toUpperCase()} ${pad(p.year, 4)}`;
}

/** Minutes since IST midnight for a `HH:MM` clock time. */
export function minutesOfDay(time: string): number {
  const [hour, minute] = time.split(':').map((part) => Number.parseInt(part, 10));
  return hour * 60 + minute;
}
