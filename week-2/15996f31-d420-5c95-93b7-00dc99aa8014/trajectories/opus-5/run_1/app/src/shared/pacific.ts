const PACIFIC_TIME_ZONE = 'America/Los_Angeles';

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const wallClockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const offsetFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TIME_ZONE,
  timeZoneName: 'longOffset',
});

function partsOf(formatter: Intl.DateTimeFormat, at: Date): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of formatter.formatToParts(at)) map.set(part.type, part.value);
  return map;
}

function pacificWallClock(at: Date): WallClock {
  const parts = partsOf(wallClockFormat, at);
  return {
    year: Number(parts.get('year')),
    month: Number(parts.get('month')),
    day: Number(parts.get('day')),
    hour: Number(parts.get('hour')),
    minute: Number(parts.get('minute')),
  };
}

/** Minutes to add to UTC to reach Pacific wall-clock time at that instant. */
function pacificOffsetMinutes(at: Date): number {
  const name = partsOf(offsetFormat, at).get('timeZoneName') ?? 'GMT+00:00';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (match === null) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** The instant at which the Pacific wall clock reads the given date and time. */
export function pacificWallClockToInstant(wall: WallClock): Date {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  let instant = asUtc - pacificOffsetMinutes(new Date(asUtc)) * 60_000;
  instant = asUtc - pacificOffsetMinutes(new Date(instant)) * 60_000;
  return new Date(instant);
}

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The America/Los_Angeles calendar date of an instant, as YYYY-MM-DD. */
export function pacificCalendarDate(at: Date): string {
  const wall = pacificWallClock(at);
  return isoDate(wall.year, wall.month, wall.day);
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  return new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** `Feb 5, 2027` from a YYYY-MM-DD Pacific calendar date. */
export function formatCalendarDate(date: string): string {
  const month = MONTH_NAMES[Number(date.slice(5, 7)) - 1] ?? 'Jan';
  return `${month} ${Number(date.slice(8, 10))}, ${Number(date.slice(0, 4))}`;
}

/** `Feb 5, 2027, 3:30 PM` in Pacific time from an instant. */
export function formatPacificDateTime(at: Date): string {
  const wall = pacificWallClock(at);
  const suffix = wall.hour < 12 ? 'AM' : 'PM';
  const hour12 = wall.hour % 12 === 0 ? 12 : wall.hour % 12;
  const date = formatCalendarDate(isoDate(wall.year, wall.month, wall.day));
  return `${date}, ${hour12}:${String(wall.minute).padStart(2, '0')} ${suffix}`;
}

/** `15:30` Pacific wall-clock time of an instant, for time inputs. */
export function formatPacificTimeInput(at: Date): string {
  const wall = pacificWallClock(at);
  return `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`;
}
