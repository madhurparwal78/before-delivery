// Site-local wall time resolution. Pure functions usable on the server and in the browser.
// Instants are epoch milliseconds; local values are whole minutes into a site-local day.

type Parts = { dayIndex: number; minutesIntoDay: number };

const partsCache = new Map<string, Parts>();

function localParts(ms: number, zone: string): Parts {
  const key = `${ms}:${zone}`;
  const cached = partsCache.get(key);
  if (cached) return cached;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const hour = Number(map.hour === '24' ? '0' : map.hour);
  const dayIndex = Math.round(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day)) / 86400000);
  const parts = { dayIndex, minutesIntoDay: hour * 60 + Number(map.minute) };
  partsCache.set(key, parts);
  if (partsCache.size > 20000) partsCache.clear();
  return parts;
}

const dayStartCache = new Map<string, number>();

/** The instant site-local midnight begins on a date, in a zone. */
export function zoneDayStart(date: string, zone: string): number {
  const key = `${zone}:${date}`;
  const cached = dayStartCache.get(key);
  if (cached !== undefined) return cached;
  const dayIndex = Math.round(Date.parse(date + 'T00:00:00Z') / 86400000);
  const base = dayIndex * 86400000;
  let lo = base - 16 * 3600000;
  let hi = base + 16 * 3600000;
  while (localParts(hi, zone).dayIndex < dayIndex) {
    lo = hi;
    hi += 3600000;
  }
  while (hi - lo > 250) {
    const mid = Math.floor((lo + hi) / 2);
    if (localParts(mid, zone).dayIndex >= dayIndex) hi = mid;
    else lo = mid;
  }
  const found = Math.round(hi / 1000) * 1000;
  dayStartCache.set(key, found);
  if (dayStartCache.size > 5000) dayStartCache.clear();
  return found;
}

/**
 * The instant of a site-local wall time on a date: the first occurrence in daylight time,
 * and a missing local time moved forward by the length of the jump.
 */
export function zoneInstant(date: string, zone: string, minutesIntoDay: number): number {
  const start = zoneDayStart(date, zone);
  if (minutesIntoDay <= 0) return start;
  if (minutesIntoDay >= 1440) return zoneDayStart(datePlusDays(date, 1), zone);
  const dayIndex = Math.round(Date.parse(date + 'T00:00:00Z') / 86400000);
  const key = `${zone}:${date}:${minutesIntoDay}`;
  const instantCache = instantCaches.get(zone) ?? new Map<string, number>();
  instantCaches.set(zone, instantCache);
  const cached = instantCache.get(key);
  if (cached !== undefined) return cached;
  let lo = start;
  let hi = start + 26 * 3600000;
  while (hi - lo > 250) {
    const mid = Math.floor((lo + hi) / 2);
    const parts = localParts(mid, zone);
    const reached = parts.dayIndex > dayIndex || (parts.dayIndex === dayIndex && parts.minutesIntoDay >= minutesIntoDay);
    if (reached) hi = mid;
    else lo = mid;
  }
  const secondAligned = Math.round(hi / 1000) * 1000;
  const probe = localParts(secondAligned, zone);
  const probeReached =
    probe.dayIndex > dayIndex || (probe.dayIndex === dayIndex && probe.minutesIntoDay >= minutesIntoDay);
  const found = probeReached ? secondAligned : secondAligned + 1000;
  instantCache.set(key, found);
  if (instantCache.size > 20000) instantCache.clear();
  return found;
}

const instantCaches = new Map<string, Map<string, number>>();

export function datePlusDays(date: string, days: number): string {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

export function dateOfInstant(ms: number, zone: string): string {
  return dateFromDayIndex(localParts(ms, zone).dayIndex);
}

export function dateFromDayIndex(dayIndex: number): string {
  return new Date(dayIndex * 86400000).toISOString().slice(0, 10);
}

export function dayIndexFromDate(date: string): number {
  return Math.round(Date.parse(date + 'T00:00:00Z') / 86400000);
}

/** Minutes into the site-local day of an instant. */
export function minutesOfInstant(ms: number, zone: string): number {
  const parts = localParts(Math.floor(ms / 1000) * 1000, zone);
  return parts.dayIndex * 1440 + parts.minutesIntoDay;
}

export function zoneOfInstant(ms: number, zone: string): { date: string; minutes: number } {
  const parts = localParts(ms, zone);
  return { date: dateFromDayIndex(parts.dayIndex), minutes: parts.minutesIntoDay };
}

export function minutesToWall(minutes: number): string {
  const intoDay = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(intoDay / 60)).padStart(2, '0')}:${String(intoDay % 60).padStart(2, '0')}`;
}

export function parseWall(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Elapsed hours between two instants in whole quarter hours, rounded up. */
export function elapsedQuarterHours(from: number, to: number): number {
  return Math.max(0, Math.ceil((to - from) / 900000));
}

export function weekdayName(date: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(
    new Date(date + 'T00:00:00Z'),
  );
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthName(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return `${MONTHS[index] ?? month} ${month.slice(0, 4)}`;
}

/** The dial angle of a wall time: 0.25 degrees per minute from 00:00. */
export function wallMinutesToDeg(minutes: number): number {
  return minutes * 0.25;
}

/** The site-local date of an instant in a zone. */
export function localDateOfInstant(ms: number, zone: string): string {
  const utcDate = new Date(ms).toISOString().slice(0, 10);
  for (const candidate of [datePlusDays(utcDate, -1), utcDate, datePlusDays(utcDate, 1)]) {
    const start = zoneDayStart(candidate, zone);
    const next = zoneDayStart(datePlusDays(candidate, 1), zone);
    if (ms >= start && ms < next) return candidate;
  }
  return utcDate;
}
