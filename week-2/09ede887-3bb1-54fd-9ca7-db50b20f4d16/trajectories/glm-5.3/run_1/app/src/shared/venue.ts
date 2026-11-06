/**
 * Venue time for Harbour Quay Hall, Port Ashby: the America/Halifax zone.
 *
 * Halifax keeps Atlantic Standard Time at UTC-4 and Atlantic Daylight Time at
 * UTC-3. Daylight time runs from the second Sunday in March at 02:00 local
 * standard (06:00Z) to the first Sunday in November at 02:00 local daylight
 * (05:00Z). Everything here is computed from those rules, never from a fixed
 * offset, so Day 1 (Sat 2026-10-31) is ADT, UTC-3, and Day 2 (Sun 2026-11-01)
 * is AST, UTC-4. Daylight time ends at 02:00 ADT on 1 November 2026, which is
 * 05:00Z.
 */

/** A UTC instant as epoch milliseconds. */
export type Instant = number;
/** A venue wall-clock time as epoch milliseconds past midnight. */
export type WallClock = number;

export const VENUE_ZONE = 'America/Halifax';
/** Daylight offset: minutes added to UTC to get local time. */
const ADT_OFFSET = -180;
/** Standard offset: minutes added to UTC to get local time. */
const AST_OFFSET = -240;

/** Offset in minutes in force at the given instant (negative: west of UTC). */
export function venueOffsetMinutes(at: Instant): number {
  const year = new Date(at).getUTCFullYear();
  // The transition instants, expressed in UTC.
  const dstStart = Date.UTC(year, 2, secondSunday(year, 2), 2, 0, 0) - AST_OFFSET * 60_000;
  const dstEnd = Date.UTC(year, 10, firstSunday(year, 10), 2, 0, 0) - ADT_OFFSET * 60_000;
  return at >= dstStart && at < dstEnd ? ADT_OFFSET : AST_OFFSET;
}

/** Day number of the first Sunday in the given month (0-based month). */
function firstSunday(year: number, month: number): number {
  const dow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return dow === 0 ? 1 : 8 - dow;
}

/** Day number of the second Sunday in the given month (0-based month). */
function secondSunday(year: number, month: number): number {
  return firstSunday(year, month) + 7;
}

/**
 * The UTC instant of a venue wall-clock time on the given ISO date.
 * A wall time in the repeated hour (01:00-01:59 on the fall-back date) takes
 * its first, daylight, occurrence.
 */
export function venueWallToInstant(date: string, wallClock: WallClock): Instant {
  const [y, mo, d] = date.split('-').map((x) => parseInt(x, 10));
  const h = Math.floor(wallClock / 3600_000) % 24;
  const m = Math.floor(wallClock / 60_000) % 60;
  const s = Math.floor(wallClock / 1000) % 60;
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, m, s);
  const daylight = wallAsUtc - ADT_OFFSET * 60_000;
  if (venueOffsetMinutes(daylight) === ADT_OFFSET) return daylight;
  return wallAsUtc - AST_OFFSET * 60_000;
}

/** The venue wall-clock reading of an instant. */
export function instantToVenueWall(at: Instant): { date: string; wallClock: WallClock } {
  const shifted = new Date(at + venueOffsetMinutes(at) * 60_000);
  return {
    date: isoDate(shifted),
    wallClock:
      shifted.getUTCHours() * 3600_000 +
      shifted.getUTCMinutes() * 60_000 +
      shifted.getUTCSeconds() * 1000,
  };
}

export function isoDate(d: Date): string {
  return (
    d.getUTCFullYear() +
    '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getUTCDate()).padStart(2, '0')
  );
}

/** The abbreviation in force during a date's daytime sessions (ADT or AST). */
export function venueAbbrevForDate(date: string): string {
  const noon = venueWallToInstant(date, 12 * 3600_000);
  return venueOffsetMinutes(noon) === ADT_OFFSET ? 'ADT' : 'AST';
}

/** UTC offset label for a date, like "-03" or "-04". */
export function venueOffsetLabel(date: string): string {
  const noon = venueWallToInstant(date, 12 * 3600_000);
  const off = venueOffsetMinutes(noon);
  const sign = off < 0 ? '-' : '+';
  return `${sign}${String(Math.abs(off / 60)).padStart(2, '0')}`;
}
