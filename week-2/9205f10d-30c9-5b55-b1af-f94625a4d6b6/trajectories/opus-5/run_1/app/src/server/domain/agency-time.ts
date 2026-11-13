export const AGENCY_TIME_ZONE = 'America/New_York';

export interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: AGENCY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const offsetFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: AGENCY_TIME_ZONE,
  timeZoneName: 'longOffset',
});

const abbreviationFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: AGENCY_TIME_ZONE,
  timeZoneName: 'short',
});

function lookup(formatter: Intl.DateTimeFormat, at: Date, type: Intl.DateTimeFormatPartTypes): string {
  for (const part of formatter.formatToParts(at)) {
    if (part.type === type) return part.value;
  }
  throw new Error(`Missing ${type} part`);
}

/** Minutes to add to UTC to reach agency local time at this instant (-300 for EST). */
export function offsetMinutesAt(at: Date): number {
  const text = lookup(offsetFormat, at, 'timeZoneName');
  if (text === 'GMT') return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(text);
  if (!match) throw new Error(`Unexpected offset ${text}`);
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

export function zoneAbbreviation(at: Date): string {
  return lookup(abbreviationFormat, at, 'timeZoneName');
}

export function toLocal(at: Date): LocalDateTime & { second: number } {
  const parts = partsFormat.formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    for (const part of parts) if (part.type === type) return Number(part.value);
    throw new Error(`Missing ${type} part`);
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

function naiveUtcMs(local: LocalDateTime): number {
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0, 0);
}

function sameLocal(at: Date, local: LocalDateTime): boolean {
  const actual = toLocal(at);
  return (
    actual.year === local.year &&
    actual.month === local.month &&
    actual.day === local.day &&
    actual.hour === local.hour &&
    actual.minute === local.minute
  );
}

/**
 * Instants matching a local agency wall-clock time: two when the clock falls back,
 * none for the hour skipped when it springs forward.
 */
function candidates(local: LocalDateTime): Date[] {
  const naive = naiveUtcMs(local);
  const found: number[] = [];
  for (const probe of [naive - 86_400_000, naive + 86_400_000]) {
    const candidate = naive - offsetMinutesAt(new Date(probe)) * 60_000;
    if (!found.includes(candidate) && sameLocal(new Date(candidate), local)) found.push(candidate);
  }
  found.sort((a, b) => a - b);
  return found.map((ms) => new Date(ms));
}

export interface LocalResolution {
  /** Absent when the local time is skipped by a spring-forward transition. */
  instant: Date | null;
  skipped: boolean;
}

/** Resolves a local agency time, taking the first occurrence when it happens twice. */
export function resolveLocal(local: LocalDateTime): LocalResolution {
  const found = candidates(local);
  const first = found[0];
  if (first === undefined) return { instant: null, skipped: true };
  return { instant: first, skipped: false };
}

/** The transition instant that swallowed a skipped local time. */
function transitionAfter(local: LocalDateTime): Date {
  const naive = naiveUtcMs(local);
  let low = naive - 86_400_000;
  let high = naive + 86_400_000;
  const startOffset = offsetMinutesAt(new Date(low));
  while (high - low > 1000) {
    const middle = low + Math.floor((high - low) / 2);
    if (offsetMinutesAt(new Date(middle)) === startOffset) low = middle;
    else high = middle;
  }
  return new Date(high);
}

/**
 * Resolves a local agency time to an instant, mapping a skipped local time to the
 * first instant after the skipped hour. Used for derived times such as the cutoff.
 */
export function resolveLocalForgiving(local: LocalDateTime): Date {
  const resolved = resolveLocal(local);
  return resolved.instant ?? transitionAfter(local);
}

export function addDaysLocal(local: LocalDateTime, days: number): LocalDateTime {
  const shifted = new Date(Date.UTC(local.year, local.month - 1, local.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: local.hour,
    minute: local.minute,
  };
}

export function isoDate(local: { year: number; month: number; day: number }): string {
  return `${String(local.year).padStart(4, '0')}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
}

export function agencyDateOf(at: Date): string {
  return isoDate(toLocal(at));
}

export function parseIsoDate(text: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/** Parses `YYYY-MM-DDTHH:MM` (agency wall clock). */
export function parseLocalDateTime(text: string): LocalDateTime | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text);
  if (!match) return null;
  const date = parseIsoDate(`${match[1]}-${match[2]}-${match[3]}`);
  if (!date) return null;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (hour > 23 || minute > 59) return null;
  return { ...date, hour, minute };
}

function offsetText(at: Date): string {
  const offset = offsetMinutesAt(at);
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

/** ISO 8601 with the agency's offset, e.g. `2026-11-03T09:00:00-05:00`. */
export function toAgencyIso(at: Date): string {
  const local = toLocal(at);
  const clock = `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}:${String(local.second).padStart(2, '0')}`;
  return `${isoDate(local)}T${clock}${offsetText(at)}`;
}

/** Start of the agency week (Monday 00:00) containing the given agency date. */
export function weekStartLocal(date: { year: number; month: number; day: number }): LocalDateTime {
  const asUtc = new Date(Date.UTC(date.year, date.month - 1, date.day));
  const weekday = asUtc.getUTCDay();
  const backToMonday = weekday === 0 ? 6 : weekday - 1;
  const monday = new Date(Date.UTC(date.year, date.month - 1, date.day - backToMonday));
  return {
    year: monday.getUTCFullYear(),
    month: monday.getUTCMonth() + 1,
    day: monday.getUTCDate(),
    hour: 0,
    minute: 0,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function monthDay(at: Date): string {
  const local = toLocal(at);
  return `${MONTHS[local.month - 1]} ${local.day}`;
}

export function weekdayShort(at: Date): string {
  const local = toLocal(at);
  const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
  return WEEKDAYS[weekday] as string;
}

export function clockTime(at: Date): string {
  const local = toLocal(at);
  const suffix = local.hour < 12 ? 'AM' : 'PM';
  const hour12 = local.hour % 12 === 0 ? 12 : local.hour % 12;
  return `${hour12}:${String(local.minute).padStart(2, '0')} ${suffix}`;
}

/** `Sun, Nov 1, 9:00 AM EST` */
export function cutoffText(at: Date): string {
  return `${weekdayShort(at)}, ${monthDay(at)}, ${clockTime(at)} ${zoneAbbreviation(at)}`;
}
