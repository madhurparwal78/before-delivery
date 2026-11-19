/**
 * Business time zone arithmetic.
 *
 * Every workspace keeps an IANA business time zone. Local dates and times are
 * read and shown in that zone, whatever the browser or the host is set to.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const HOUR_MS = 3600_000;

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function partFormatter(zone: string): Intl.DateTimeFormat {
  let found = partFormatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    partFormatters.set(zone, found);
  }
  return found;
}

const abbrevFormatters = new Map<string, Intl.DateTimeFormat>();

function abbrevFormatter(zone: string): Intl.DateTimeFormat {
  let found = abbrevFormatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' });
    abbrevFormatters.set(zone, found);
  }
  return found;
}

export function partsInZone(instantMs: number, zone: string): ZonedParts {
  const parts = partFormatter(zone).formatToParts(new Date(instantMs));
  const table: Record<string, string> = {};
  for (const part of parts) table[part.type] = part.value;
  const weekdayName = table['weekday'] ?? 'Sun';
  const weekday = WEEKDAYS.indexOf(weekdayName as (typeof WEEKDAYS)[number]);
  let hour = Number(table['hour'] ?? '0');
  if (hour === 24) hour = 0;
  return {
    year: Number(table['year'] ?? '1970'),
    month: Number(table['month'] ?? '1'),
    day: Number(table['day'] ?? '1'),
    hour,
    minute: Number(table['minute'] ?? '0'),
    second: Number(table['second'] ?? '0'),
    weekday: weekday < 0 ? 0 : weekday,
  };
}

/** Offset of `zone` from UTC at the given instant, in milliseconds. */
export function zoneOffsetMs(instantMs: number, zone: string): number {
  const p = partsInZone(instantMs, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

export function zoneAbbreviation(instantMs: number, zone: string): string {
  const parts = abbrevFormatter(zone).formatToParts(new Date(instantMs));
  const found = parts.find((part) => part.type === 'timeZoneName');
  return found ? found.value : 'UTC';
}

/**
 * Turn a wall-clock date and time in `zone` into an instant.
 *
 * A wall time that the spring-forward gap skips moves forward by the length of
 * the jump; a wall time that happens twice resolves to its first occurrence.
 */
export function wallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  zone: string,
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const beforeOffset = zoneOffsetMs(wall - 12 * HOUR_MS, zone);
  const afterOffset = zoneOffsetMs(wall + 12 * HOUR_MS, zone);
  const candidates = beforeOffset === afterOffset ? [wall - beforeOffset] : [wall - beforeOffset, wall - afterOffset];
  const valid = candidates.filter((instant) => zoneOffsetMs(instant, zone) + instant === wall);
  if (valid.length > 0) return Math.min(...valid);
  return wall - beforeOffset;
}

export function offsetSuffix(instantMs: number, zone: string): string {
  const offset = zoneOffsetMs(instantMs, zone);
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  const hours = Math.floor(absolute / HOUR_MS);
  const minutes = Math.floor((absolute % HOUR_MS) / 60_000);
  return `${sign}${pad2(hours)}:${pad2(minutes)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Workspace-local ISO 8601 with offset, e.g. `2026-11-02T06:30:00-06:00`. */
export function localIso(instantMs: number, zone: string): string {
  const p = partsInZone(instantMs, zone);
  return `${String(p.year).padStart(4, '0')}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}:${pad2(
    p.second,
  )}${offsetSuffix(instantMs, zone)}`;
}

/**
 * The one workspace-local display format: `Mon 2 Nov, 06:30 CST`.
 */
export function formatWhen(instantMs: number, zone: string): string {
  const p = partsInZone(instantMs, zone);
  const weekday = WEEKDAYS[p.weekday] ?? 'Sun';
  const month = MONTHS[p.month - 1] ?? 'Jan';
  return `${weekday} ${p.day} ${month}, ${pad2(p.hour)}:${pad2(p.minute)} ${zoneAbbreviation(instantMs, zone)}`;
}

/** The business date in `zone`, e.g. `2026-11-02`. */
export function businessDate(instantMs: number, zone: string): string {
  const p = partsInZone(instantMs, zone);
  return `${String(p.year).padStart(4, '0')}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** The business date written for an email subject, e.g. `Wed 28 Oct`. */
export function businessDateLabel(instantMs: number, zone: string): string {
  const p = partsInZone(instantMs, zone);
  const weekday = WEEKDAYS[p.weekday] ?? 'Sun';
  const month = MONTHS[p.month - 1] ?? 'Jan';
  return `${weekday} ${p.day} ${month}`;
}

export function startOfBusinessDay(instantMs: number, zone: string, hour: number): number {
  const p = partsInZone(instantMs, zone);
  return wallTimeToInstant(p.year, p.month, p.day, hour, 0, 0, zone);
}

