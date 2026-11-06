/** Business time: every business date, month, stamp and report range. */

const PART_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function partFormatter(timeZone: string): Intl.DateTimeFormat {
  const found = PART_FORMATTERS.get(timeZone);
  if (found !== undefined) return found;
  const made = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  PART_FORMATTERS.set(timeZone, made);
  return made;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function wallClock(instant: Date, timeZone: string): WallClock {
  const parts = partFormatter(timeZone).formatToParts(instant);
  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return Number.parseInt(part === undefined ? '0' : part.value, 10);
  };
  const hour = field('hour');
  return {
    year: field('year'),
    month: field('month'),
    day: field('day'),
    hour: hour === 24 ? 0 : hour,
    minute: field('minute'),
    second: field('second'),
  };
}

function offsetMs(instant: Date, timeZone: string): number {
  const clock = wallClock(instant, timeZone);
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant of a wall-clock time in a time zone. */
export function fromWallClock(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = offsetMs(new Date(guess), timeZone);
  const candidate = new Date(guess - firstOffset);
  const secondOffset = offsetMs(candidate, timeZone);
  if (secondOffset === firstOffset) return candidate;
  return new Date(guess - secondOffset);
}

export function businessDate(instant: Date, timeZone: string): string {
  const clock = wallClock(instant, timeZone);
  return `${pad(clock.year, 4)}-${pad(clock.month, 2)}-${pad(clock.day, 2)}`;
}

export function businessMonth(instant: Date, timeZone: string): string {
  const clock = wallClock(instant, timeZone);
  return `${pad(clock.year, 4)}-${pad(clock.month, 2)}`;
}

function pad(value: number, width: number): string {
  return value.toString().padStart(width, '0');
}

const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_SHAPE = /^(\d{4})-(\d{2})$/;

export function isBusinessDate(value: string): boolean {
  const match = DATE_SHAPE.exec(value);
  if (match === null) return false;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

export function isBusinessMonth(value: string): boolean {
  const match = MONTH_SHAPE.exec(value);
  if (match === null) return false;
  const month = Number.parseInt(match[2], 10);
  return month >= 1 && month <= 12;
}

/** Local midnight that opens a business date. */
export function startOfBusinessDate(date: string, timeZone: string): Date {
  const match = DATE_SHAPE.exec(date);
  if (match === null) throw new Error(`Not a business date: ${date}`);
  return fromWallClock(
    timeZone,
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2], 10),
    Number.parseInt(match[3], 10),
  );
}

export function nextBusinessDate(date: string): string {
  const match = DATE_SHAPE.exec(date);
  if (match === null) throw new Error(`Not a business date: ${date}`);
  const probe = new Date(
    Date.UTC(
      Number.parseInt(match[1], 10),
      Number.parseInt(match[2], 10) - 1,
      Number.parseInt(match[3], 10) + 1,
    ),
  );
  return `${pad(probe.getUTCFullYear(), 4)}-${pad(probe.getUTCMonth() + 1, 2)}-${pad(probe.getUTCDate(), 2)}`;
}

/** Local midnight on the first of a business month. */
export function startOfBusinessMonth(month: string, timeZone: string): Date {
  const match = MONTH_SHAPE.exec(month);
  if (match === null) throw new Error(`Not a business month: ${month}`);
  return fromWallClock(timeZone, Number.parseInt(match[1], 10), Number.parseInt(match[2], 10), 1);
}

export function nextBusinessMonth(month: string): string {
  const match = MONTH_SHAPE.exec(month);
  if (match === null) throw new Error(`Not a business month: ${month}`);
  const year = Number.parseInt(match[1], 10);
  const index = Number.parseInt(match[2], 10);
  return index === 12 ? `${pad(year + 1, 4)}-01` : `${pad(year, 4)}-${pad(index + 1, 2)}`;
}

export function previousBusinessMonth(month: string): string {
  const match = MONTH_SHAPE.exec(month);
  if (match === null) throw new Error(`Not a business month: ${month}`);
  const year = Number.parseInt(match[1], 10);
  const index = Number.parseInt(match[2], 10);
  return index === 1 ? `${pad(year - 1, 4)}-12` : `${pad(year, 4)}-${pad(index - 1, 2)}`;
}

/** Whole-second UTC instant with a Z, the one instant shape in the API. */
export function toInstant(value: Date): string {
  return `${new Date(Math.floor(value.getTime() / 1000) * 1000).toISOString().slice(0, 19)}Z`;
}

const MONTH_NAMES = [
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

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function monthLabel(month: string): string {
  const match = MONTH_SHAPE.exec(month);
  if (match === null) throw new Error(`Not a business month: ${month}`);
  return `${MONTH_NAMES[Number.parseInt(match[2], 10) - 1]} ${match[1]}`;
}

export function dateLabel(date: string): string {
  const match = DATE_SHAPE.exec(date);
  if (match === null) throw new Error(`Not a business date: ${date}`);
  return `${Number.parseInt(match[3], 10)} ${SHORT_MONTHS[Number.parseInt(match[2], 10) - 1]} ${match[1]}`;
}

/** The screen date-time format, for example `Tue 6 Apr 2027, 11:00 Vilnius time`. */
export function dateTimeLabel(instant: Date, timeZone: string, city: string): string {
  const clock = wallClock(instant, timeZone);
  const weekdayIndex = new Date(Date.UTC(clock.year, clock.month - 1, clock.day)).getUTCDay();
  return `${SHORT_WEEKDAYS[weekdayIndex]} ${clock.day} ${SHORT_MONTHS[clock.month - 1]} ${clock.year}, ${pad(clock.hour, 2)}:${pad(clock.minute, 2)} ${city} time`;
}
