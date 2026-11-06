// Venue time: Harbour Quay Hall keeps America/Halifax time. This is the only place a venue
// wall-clock time becomes a UTC instant, always through the zone's rules, never a fixed offset.

export const VENUE_ZONE = 'America/Halifax';

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: VENUE_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

// Minutes the venue's wall clock is ahead of UTC at the given instant (negative in Halifax).
function offsetMinutes(utcMs: number): number {
  const field = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.formatToParts(utcMs).find((part) => part.type === type)?.value);
  const wall = Date.UTC(field('year'), field('month') - 1, field('day'), field('hour'), field('minute'), field('second'));
  return Math.round((wall - Math.floor(utcMs / 1000) * 1000) / 60000);
}

// The UTC instant of a venue wall-clock time. A time in the repeated hour takes its first
// (daylight) occurrence, because the first offset tried is the one in force just before it.
export function venueInstant(date: string, hhmm: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = hhmm.split(':').map(Number);
  const wall = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);
  const before = offsetMinutes(wall - 3 * 3600_000);
  const candidate = wall - before * 60_000;
  if (offsetMinutes(candidate) === before) return new Date(candidate);
  return new Date(wall - offsetMinutes(candidate) * 60_000);
}
