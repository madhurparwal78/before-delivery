const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
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

const MINUTE = 60_000;
const DAY_MS = 86_400_000;

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatterCache.set(timeZone, created);
  return created;
}

export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The wall clock reading shown in `timeZone` at `instant`. */
export function wallClockAt(instant: Date, timeZone: string): WallClock & { second: number } {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : 0;
  };
  const hour = read('hour');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
    second: read('second'),
  };
}

function offsetMinutes(instant: Date, timeZone: string): number {
  const wall = wallClockAt(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / MINUTE;
}

/**
 * The instant for a wall clock reading in `timeZone`. Ambiguous readings (a clock
 * turned back) resolve to the earlier instant; readings inside a daylight-saving gap
 * resolve to the same wall offset after the gap, so 02:30 becomes 03:30.
 */
export function instantFromWallClock(wall: WallClock, timeZone: string): Date {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const before = offsetMinutes(new Date(asUtc - DAY_MS), timeZone);
  const after = offsetMinutes(new Date(asUtc + DAY_MS), timeZone);
  const candidates = before === after ? [before] : [before, after];
  for (const candidate of candidates) {
    const instant = new Date(asUtc - candidate * MINUTE);
    const check = wallClockAt(instant, timeZone);
    if (
      check.year === wall.year &&
      check.month === wall.month &&
      check.day === wall.day &&
      check.hour === wall.hour &&
      check.minute === wall.minute
    ) {
      return instant;
    }
  }
  return new Date(asUtc - before * MINUTE);
}

export function parseDate(date: string): WallClock {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Not a date: ${date}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: 0,
    minute: 0,
  };
}

export function isDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const wall = parseDate(value);
  const probe = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  return (
    probe.getUTCFullYear() === wall.year &&
    probe.getUTCMonth() + 1 === wall.month &&
    probe.getUTCDate() === wall.day
  );
}

export function isTimeString(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

export function formatDate(wall: WallClock): string {
  return `${String(wall.year).padStart(4, '0')}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
}

export function formatTime(minutesOfDay: number): string {
  const normalised = ((minutesOfDay % 1440) + 1440) % 1440;
  const hour = Math.floor(normalised / 60);
  const minute = normalised % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function minutesOfDay(time: string): number {
  const [hour, minute] = time.split(':');
  return Number(hour) * 60 + Number(minute);
}

/** The member's today: the current date in their profile time zone. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  return formatDate(wallClockAt(now, timeZone));
}

export function localDateOf(instant: Date, timeZone: string): string {
  return formatDate(wallClockAt(instant, timeZone));
}

export function localTimeOf(instant: Date, timeZone: string): string {
  const wall = wallClockAt(instant, timeZone);
  return formatTime(wall.hour * 60 + wall.minute);
}

export function addDays(date: string, days: number): string {
  const wall = parseDate(date);
  const shifted = new Date(Date.UTC(wall.year, wall.month - 1, wall.day) + days * DAY_MS);
  return formatDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: 0,
    minute: 0,
  });
}

export function startOfLocalDay(date: string, timeZone: string): Date {
  return instantFromWallClock(parseDate(date), timeZone);
}

export function endOfLocalDay(date: string, timeZone: string): Date {
  return startOfLocalDay(addDays(date, 1), timeZone);
}

export function instantAtLocalTime(date: string, time: string, timeZone: string): Date {
  const wall = parseDate(date);
  const total = minutesOfDay(time);
  return instantFromWallClock(
    { ...wall, hour: Math.floor(total / 60), minute: total % 60 },
    timeZone,
  );
}

/** Day label: weekday, day number and month name, for example "Thursday 29 October". */
export function dayLabel(date: string): string {
  const wall = parseDate(date);
  const weekday = dayOfWeek(date);
  return `${WEEKDAYS[weekday]} ${wall.day} ${MONTHS[wall.month - 1]}`;
}

/** Short day: three-letter weekday and day number, for example "Thu 29". */
export function shortDayLabel(date: string): string {
  const wall = parseDate(date);
  return `${WEEKDAYS[dayOfWeek(date)]!.slice(0, 3)} ${wall.day}`;
}

/** 0 is Sunday, 6 is Saturday. */
export function dayOfWeek(date: string): number {
  const wall = parseDate(date);
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
}

export function compareDates(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isoWeekOf(date: string): string {
  const wall = parseDate(date);
  const utc = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  const day = utc.getUTCDay() === 0 ? 7 : utc.getUTCDay();
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const year = utc.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstDay = firstThursday.getUTCDay() === 0 ? 7 : firstThursday.getUTCDay();
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstDay);
  const week = 1 + Math.round((utc.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function isoWeekMonday(week: string): string | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!match) return null;
  const year = Number(match[1]);
  const weekNumber = Number(match[2]);
  if (weekNumber < 1 || weekNumber > 53) return null;
  const fourthJanuary = new Date(Date.UTC(year, 0, 4));
  const day = fourthJanuary.getUTCDay() === 0 ? 7 : fourthJanuary.getUTCDay();
  const firstMonday = new Date(fourthJanuary.getTime() - (day - 1) * DAY_MS);
  const monday = new Date(firstMonday.getTime() + (weekNumber - 1) * 7 * DAY_MS);
  const result = formatDate({
    year: monday.getUTCFullYear(),
    month: monday.getUTCMonth() + 1,
    day: monday.getUTCDate(),
    hour: 0,
    minute: 0,
  });
  return isoWeekOf(result) === week ? result : null;
}

export function instantToIso(instant: Date): string {
  return `${instant.toISOString().slice(0, 19)}Z`;
}

export function icsStamp(instant: Date): string {
  return `${instant.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
}
