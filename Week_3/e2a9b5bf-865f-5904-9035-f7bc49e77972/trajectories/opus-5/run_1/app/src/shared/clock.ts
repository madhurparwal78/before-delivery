/** Evening dates, site-zone wall clocks and UTC offsets. */

export const TIME_ZONES: readonly string[] = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Budapest',
  'Africa/Johannesburg',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

export function isTimeZone(value: unknown): boolean {
  return typeof value === 'string' && TIME_ZONES.includes(value);
}

const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/;

/**
 * Parse an input timestamp. It must end in Z, with an optional fraction of one
 * to three digits. The fraction is kept for comparisons.
 */
export function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;
  const millis = Date.parse(value);
  if (Number.isNaN(millis)) return null;
  const date = new Date(millis);
  // Reject values the pattern allows but the calendar does not, such as 02-30.
  if (formatTimestamp(date).slice(0, 10) !== `${match[1]}-${match[2]}-${match[3]}`) return null;
  return date;
}

/** Every timestamp in a response is exactly YYYY-MM-DDTHH:MM:SSZ, fraction dropped. */
export function formatTimestamp(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = zoneFormatter(timeZone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

function pad(value: number, width = 2): string {
  return String(Math.abs(value)).padStart(width, '0');
}

/** The site zone's UTC offset at that exact instant, as +HH:MM or -HH:MM. */
export function utcOffset(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const minutes = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  const sign = minutes < 0 ? '-' : '+';
  return `${sign}${pad(Math.trunc(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
}

/** The site-zone wall clock as HH:MM. */
export function localClock(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * A session's evening date: the site-zone calendar date of its start, or the day
 * before when the local start time is earlier than 12:00.
 */
export function eveningDate(startedAt: Date, timeZone: string): string {
  const parts = zonedParts(startedAt, timeZone);
  if (parts.hour >= 12) {
    return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
  }
  const previous = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

export const OBSERVATION_WINDOW_MS = 18 * 60 * 60 * 1000;
export const CLOCK_SKEW_MS = 60 * 1000;

/** An observation time falls at or after its session start and inside 18 elapsed hours. */
export function withinObservationWindow(observedAt: Date, startedAt: Date): boolean {
  const elapsed = observedAt.getTime() - startedAt.getTime();
  return elapsed >= 0 && elapsed < OBSERVATION_WINDOW_MS;
}

/** The local time line shown beside the UT field. */
export function localTimeLine(date: Date, timeZone: string): string {
  return `${localClock(date, timeZone)} local, UTC${utcOffset(date, timeZone)}`;
}

/** Accept the `YYYY-MM-DD HH:MM` the UT field is typed in. */
export function parseUtFieldValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return parseTimestamp(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00Z`,
  );
}

export function toUtFieldValue(timestamp: string): string {
  return `${timestamp.slice(0, 10)} ${timestamp.slice(11, 16)}`;
}
