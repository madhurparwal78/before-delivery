export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function partsInZone(instant: Date, timeZone: string): ZonedParts {
  const map = new Map<string, string>();
  for (const part of partsFormatter(timeZone).formatToParts(instant)) {
    map.set(part.type, part.value);
  }
  const hour = Number(map.get('hour'));
  return {
    year: Number(map.get('year')),
    month: Number(map.get('month')),
    day: Number(map.get('day')),
    hour: hour === 24 ? 0 : hour,
    minute: Number(map.get('minute')),
    second: Number(map.get('second')),
  };
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = partsInZone(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - instant.getTime();
}

export function instantFromZoned(parts: ZonedParts, timeZone: string): Date {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let instant = naive - zoneOffsetMs(new Date(naive), timeZone);
  instant = naive - zoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

export function addCalendarDays(instant: Date, days: number, timeZone: string): Date {
  const parts = partsInZone(instant, timeZone);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return instantFromZoned(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
    },
    timeZone,
  );
}

export function startOfDayInZone(year: number, month: number, day: number, timeZone: string): Date {
  return instantFromZoned({ year, month, day, hour: 0, minute: 0, second: 0 }, timeZone);
}

export function toIso(instant: Date): string {
  return `${instant.toISOString().slice(0, 19)}Z`;
}

export function addSeconds(instant: Date, seconds: number): Date {
  return new Date(instant.getTime() + seconds * 1000);
}

const displayFormatters = new Map<string, Intl.DateTimeFormat>();

/** Human time in a given zone, formatted like "27 Oct 2026, 14:05". */
export function formatDisplayTime(instant: Date, timeZone: string): string {
  let formatter = displayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    displayFormatters.set(timeZone, formatter);
  }
  return formatter.format(instant).replace(' at ', ', ');
}
