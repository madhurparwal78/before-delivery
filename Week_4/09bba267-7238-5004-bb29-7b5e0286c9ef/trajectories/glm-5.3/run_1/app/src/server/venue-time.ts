const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const VENUE_TZ = 'America/Chicago';

function partsInVenue(instant: Date): { weekday: string; day: string; month: string; year: string; hour: string; minute: string; ampm: 'AM' | 'PM'; tz: 'CST' | 'CDT' } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: VENUE_TZ,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
  const hourNum = Number(parts.hour);
  const hour = hourNum === 0 ? '12' : String(hourNum);
  return {
    weekday: parts.weekday.replace('.', ''),
    day: parts.day,
    month: parts.month.replace('.', ''),
    year: parts.year,
    hour,
    minute: parts.minute,
    ampm: parts.dayPeriod as 'AM' | 'PM',
    tz: parts.timeZoneName === 'CDT' ? 'CDT' : 'CST',
  };
}

/** The venue-time start label, e.g. `Fri 12 Feb 2027, 8:00 PM CST`. */
export function venueLabel(instant: Date): string {
  const p = partsInVenue(instant);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${p.ampm} ${p.tz}`;
}

/** The offer-deadline form, e.g. `1:42:05 PM CST on Sun 7 Nov 2027`. */
export function venueOfferExpiry(instant: Date): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: VENUE_TZ,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(instant).map((x) => [x.type, x.value]));
  const hourNum = Number(parts.hour);
  const hour = hourNum === 0 ? '12' : String(hourNum);
  const day = partsInVenue(instant);
  return `${hour}:${parts.minute}:${parts.second} ${parts.dayPeriod} ${parts.timeZoneName} on ${day.weekday} ${day.day} ${day.month} ${day.year}`;
}

/**
 * Resolve a venue-time wall clock (`YYYY-MM-DDTHH:MM` in America/Chicago) to an instant.
 * On the fall-back night the first occurrence wins; a wall time skipped by the
 * spring-forward gap does not exist and is refused.
 */
export function resolveVenueWallClock(startsLocal: string, now: Date): { ok: true; instant: Date } | { ok: false; reason: 'format' | 'nonexistent' | 'past' } {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(startsLocal);
  if (!match) return { ok: false, reason: 'format' };
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (month < 1 || month > 12 || day < 1 || day > 31) return { ok: false, reason: 'format' };

  const utcFromWall = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = candidateOffsets(utcFromWall);
  if (offsets.length === 0) return { ok: false, reason: 'nonexistent' };
  // The first entry is the earlier occurrence in real time (CDT before CST on the fall-back night).
  const instant = new Date(utcFromWall - offsets[0] * 3600_000);
  if (instant.getTime() <= now.getTime()) return { ok: false, reason: 'past' };
  return { ok: true, instant };
}

function candidateOffsets(wallUtcGuess: number): number[] {
  const found: number[] = [];
  for (const offset of [-5, -6]) {
    if (found.includes(offset)) continue;
    const probe = new Date(wallUtcGuess - offset * 3600_000);
    if (venueOffsetHours(probe) === offset && roundTrip(probe, wallUtcGuess)) {
      found.push(offset);
    }
  }
  // Hours west of UTC (negative): -5 (CDT, the first occurrence) before -6 (CST).
  return found;
}

function roundTrip(instant: Date, wallUtcGuess: number): boolean {
  return instant.getTime() + venueOffsetHours(instant) * 3600_000 === wallUtcGuess;
}

export function venueOffsetHours(instant: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: VENUE_TZ, timeZoneName: 'shortOffset' });
  const parts = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
  const name = parts.timeZoneName as string;
  const match = /GMT([+-])(\d{1,2})/.exec(name);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * Number(match[2]);
}

export const MONTH_NAMES = MONTHS;
export const WEEKDAY_NAMES = WEEKDAYS;
