/**
 * The single place where an America/New_York wall time becomes an instant and
 * back. Every session, week-end and day-end instant in Tracewell goes through
 * here, so each one carries the offset in force on its own date.
 */
const ZONE = 'America/New_York';

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface NewYorkInstant extends WallTime {
  /** Minutes east of UTC, so -240 during daylight time and -300 in standard time. */
  offsetMinutes: number;
}

export function wallOf(epochMs: number): NewYorkInstant {
  const parts = partsFormat.formatToParts(epochMs);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : 0;
  };
  const hour24 = read('hour') % 24;
  const wall: WallTime = {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour24,
    minute: read('minute'),
    second: read('second'),
  };
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return { ...wall, offsetMinutes: Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60000) };
}

function offsetMinutesAt(epochMs: number): number {
  return wallOf(epochMs).offsetMinutes;
}

/**
 * Converts a New York wall time to an instant. A wall time that occurs twice
 * when clocks fall back means the earlier instant; a wall time that does not
 * exist returns null.
 */
export function wallTimeToInstant(wall: WallTime): number | null {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const candidateOffsets = new Set<number>([
    offsetMinutesAt(asUtc + 12 * 3600_000),
    offsetMinutesAt(asUtc - 12 * 3600_000),
  ]);
  const instants: number[] = [];
  for (const offsetMinutes of candidateOffsets) {
    const candidate = asUtc - offsetMinutes * 60_000;
    const back = wallOf(candidate);
    if (
      back.offsetMinutes === offsetMinutes &&
      back.year === wall.year &&
      back.month === wall.month &&
      back.day === wall.day &&
      back.hour === wall.hour &&
      back.minute === wall.minute &&
      back.second === wall.second
    ) {
      instants.push(candidate);
    }
  }
  if (instants.length === 0) return null;
  return Math.min(...instants);
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export function parseDateString(text: string): CalendarDate | null {
  const match = DATE_PATTERN.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

export function formatDateString(date: CalendarDate): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

/** Calendar arithmetic on dates, never by adding fixed spans to an instant. */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** 0 is Sunday, 1 is Monday, through 6 for Saturday. */
export function weekdayOf(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function compareDates(a: CalendarDate, b: CalendarDate): number {
  const left = formatDateString(a);
  const right = formatDateString(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireInstant(wall: WallTime): number {
  const instant = wallTimeToInstant(wall);
  if (instant === null) {
    throw new Error('wall time does not exist in America/New_York');
  }
  return instant;
}

export function dateAtTime(date: CalendarDate, hour: number, minute: number, second: number): number {
  return requireInstant({ ...date, hour, minute, second });
}

/** The instant the New York day ends, which is the next day's midnight. */
export function endOfDayExclusive(date: CalendarDate): number {
  return dateAtTime(addDays(date, 1), 0, 0, 0);
}

export function newYorkDateOf(epochMs: number): CalendarDate {
  const wall = wallOf(epochMs);
  return { year: wall.year, month: wall.month, day: wall.day };
}

export function newYorkDateStringOf(epochMs: number): string {
  return formatDateString(newYorkDateOf(epochMs));
}

function offsetSuffix(offsetMinutes: number): string {
  const sign = offsetMinutes <= 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minutes = String(absolute % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

const two = (value: number): string => String(value).padStart(2, '0');

/** ISO 8601 with the America/New_York offset in force at that instant. */
export function toIso(epochMs: number): string {
  const wall = wallOf(epochMs);
  const millis = ((epochMs % 1000) + 1000) % 1000;
  const fraction = millis === 0 ? '' : `.${String(millis).padStart(3, '0')}`;
  return (
    `${String(wall.year).padStart(4, '0')}-${two(wall.month)}-${two(wall.day)}` +
    `T${two(wall.hour)}:${two(wall.minute)}:${two(wall.second)}${fraction}${offsetSuffix(wall.offsetMinutes)}`
  );
}

export function formatClockTime(epochMs: number): string {
  const wall = wallOf(epochMs);
  return `${two(wall.hour)}:${two(wall.minute)}:${two(wall.second)}`;
}

export function formatShortClockTime(epochMs: number): string {
  const wall = wallOf(epochMs);
  return `${two(wall.hour)}:${two(wall.minute)}`;
}

export function formatWallStamp(epochMs: number): string {
  const wall = wallOf(epochMs);
  return (
    `${String(wall.year).padStart(4, '0')}-${two(wall.month)}-${two(wall.day)} ` +
    `${two(wall.hour)}:${two(wall.minute)}:${two(wall.second)}`
  );
}

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3})\d*)?(Z|[+-]\d{2}:?\d{2})$/;

/** Parses an ISO instant that carries an explicit offset or Z. */
export function parseIsoInstant(text: string): number | null {
  if (typeof text !== 'string') return null;
  const match = ISO_PATTERN.exec(text.trim());
  if (!match) return null;
  const date = parseDateString(`${match[1]}-${match[2]}-${match[3]}`);
  if (!date) return null;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const millis = match[7] ? Number(match[7].padEnd(3, '0')) : 0;
  const zone = match[8] as string;
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    const body = zone.slice(1).replace(':', '');
    offsetMinutes = sign * (Number(body.slice(0, 2)) * 60 + Number(body.slice(2, 4)));
  }
  return (
    Date.UTC(date.year, date.month - 1, date.day, hour, minute, second, millis) - offsetMinutes * 60_000
  );
}

const WALL_STAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/** Parses the operator's `YYYY-MM-DD HH:MM:SS` New York wall time. */
export function parseWallStamp(text: string): number | null {
  const match = WALL_STAMP_PATTERN.exec(text.trim());
  if (!match) return null;
  const date = parseDateString(`${match[1]}-${match[2]}-${match[3]}`);
  if (!date) return null;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return wallTimeToInstant({ ...date, hour, minute, second });
}
