export const VENUE_TIME_ZONE = 'America/Chicago';

const WALL_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DAY_MS = 86_400_000;

interface VenueParts {
  readonly weekday: string;
  readonly day: number;
  readonly month: string;
  readonly year: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly dayPeriod: string;
  readonly zoneName: string;
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: VENUE_TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
  timeZoneName: 'short',
});

const wallClockFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: VENUE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function venuePartsOf(instant: Date): VenueParts {
  const found = new Map(partsFormatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    weekday: found.get('weekday') ?? '',
    day: Number(found.get('day')),
    month: found.get('month') ?? '',
    year: Number(found.get('year')),
    hour: Number(found.get('hour')),
    minute: Number(found.get('minute')),
    second: Number(found.get('second')),
    dayPeriod: found.get('dayPeriod') ?? '',
    zoneName: found.get('timeZoneName') ?? '',
  };
}

/** The venue wall-clock time of an instant, expressed as a UTC-based millisecond count. */
function venueWallMs(instant: Date): number {
  const found = new Map(wallClockFormatter.formatToParts(instant).map((part) => [part.type, part.value]));
  const hour = Number(found.get('hour')) % 24;
  return Date.UTC(
    Number(found.get('year')),
    Number(found.get('month')) - 1,
    Number(found.get('day')),
    hour,
    Number(found.get('minute')),
    Number(found.get('second')),
  );
}

function venueOffsetMs(instant: Date): number {
  return venueWallMs(instant) - instant.getTime();
}

/** `Fri 12 Feb 2027, 8:00 PM CST` */
export function formatVenueStart(instant: Date): string {
  const parts = venuePartsOf(instant);
  const minute = parts.minute.toString().padStart(2, '0');
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${minute} ${parts.dayPeriod} ${parts.zoneName}`;
}

/** `11:59:30 PM CST on Fri 12 Feb 2027` */
export function formatVenueExpiry(instant: Date): string {
  const parts = venuePartsOf(instant);
  const minute = parts.minute.toString().padStart(2, '0');
  const second = parts.second.toString().padStart(2, '0');
  const clock = `${parts.hour}:${minute}:${second} ${parts.dayPeriod} ${parts.zoneName}`;
  return `${clock} on ${parts.weekday} ${parts.day} ${parts.month} ${parts.year}`;
}

export type WallTimeResult =
  | { readonly ok: true; readonly instant: Date }
  | { readonly ok: false; readonly reason: 'malformed' | 'nonexistent' };

/**
 * Turns `YYYY-MM-DDTHH:MM` venue wall time into an instant. A wall time that happens twice on
 * the night clocks fall back resolves to its first occurrence; a skipped wall time is rejected.
 */
export function instantFromVenueWallTime(wallTime: string): WallTimeResult {
  const match = WALL_TIME_PATTERN.exec(wallTime);
  if (!match) return { ok: false, reason: 'malformed' };
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return { ok: false, reason: 'malformed' };
  }
  const wallMs = Date.UTC(year, month - 1, day, hour, minute);
  const calendar = new Date(wallMs);
  const sameCalendarDay =
    calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day;
  if (!sameCalendarDay) return { ok: false, reason: 'nonexistent' };

  const candidateOffsets = new Set([
    venueOffsetMs(new Date(wallMs - DAY_MS)),
    venueOffsetMs(new Date(wallMs + DAY_MS)),
  ]);
  const instants: number[] = [];
  for (const offset of candidateOffsets) {
    const instant = wallMs - offset;
    if (venueOffsetMs(new Date(instant)) === offset) instants.push(instant);
  }
  if (instants.length === 0) return { ok: false, reason: 'nonexistent' };
  return { ok: true, instant: new Date(Math.min(...instants)) };
}

export function toIsoSeconds(instant: Date): string {
  return `${instant.toISOString().slice(0, 19)}Z`;
}
