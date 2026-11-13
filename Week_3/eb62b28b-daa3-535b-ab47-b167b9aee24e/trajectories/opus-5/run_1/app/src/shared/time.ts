export type TimeZoneId = 'newYork' | 'chicago' | 'denver' | 'phoenix' | 'losAngeles';

export const PRACTICE_ZONE: TimeZoneId = 'phoenix';

const ZONES: Record<TimeZoneId, { iana: string; city: string }> = {
  newYork: { iana: 'America/New_York', city: 'New York' },
  chicago: { iana: 'America/Chicago', city: 'Chicago' },
  denver: { iana: 'America/Denver', city: 'Denver' },
  phoenix: { iana: 'America/Phoenix', city: 'Phoenix' },
  losAngeles: { iana: 'America/Los_Angeles', city: 'Los Angeles' },
};

export const TIME_ZONE_IDS = Object.keys(ZONES) as TimeZoneId[];

export function ianaZone(zone: TimeZoneId): string {
  return ZONES[zone].iana;
}

export function zoneCity(zone: TimeZoneId): string {
  return ZONES[zone].city;
}

export function zoneLabel(zone: TimeZoneId): string {
  return `${ZONES[zone].city} time`;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: TimeZoneId): Intl.DateTimeFormat {
  const key = `parts:${zone}`;
  let formatter = partFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: ianaZone(zone),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    partFormatters.set(key, formatter);
  }
  return formatter;
}

export function localParts(instant: Date, zone: TimeZoneId): LocalParts {
  const parts = partsFormatter(zone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return Number(found ? found.value : '0');
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

function offsetMs(instant: Date, zone: TimeZoneId): number {
  const parts = localParts(instant, zone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant of a wall-clock time in a zone. */
export function instantOfLocal(
  zone: TimeZoneId,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = offsetMs(new Date(guess), zone);
  let stamp = guess - firstOffset;
  const secondOffset = offsetMs(new Date(stamp), zone);
  if (secondOffset !== firstOffset) stamp = guess - secondOffset;
  return new Date(stamp);
}

export function localDate(instant: Date, zone: TimeZoneId): string {
  const parts = localParts(instant, zone);
  return `${pad4(parts.year)}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function localTime(instant: Date, zone: TimeZoneId): string {
  const parts = localParts(instant, zone);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function pad4(value: number): string {
  return String(value).padStart(4, '0');
}

export interface DateOnly {
  year: number;
  month: number;
  day: number;
}

export function parseDateOnly(text: string): DateOnly | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function formatDateOnly(date: DateOnly): string {
  return `${pad4(date.year)}-${pad2(date.month)}-${pad2(date.day)}`;
}

export function parseTimeOfDay(text: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Days between two local dates, as whole days on the proleptic calendar. */
export function dateOnlyDifference(from: DateOnly, to: DateOnly): number {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / 86400000);
}

export function addDays(date: DateOnly, days: number): DateOnly {
  const stamp = Date.UTC(date.year, date.month - 1, date.day) + days * 86400000;
  const moved = new Date(stamp);
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

/** 1 is Monday … 7 is Sunday. */
export function isoWeekday(date: DateOnly): number {
  const stamp = Date.UTC(date.year, date.month - 1, date.day);
  const day = new Date(stamp).getUTCDay();
  return day === 0 ? 7 : day;
}

export function wholeYearsBetween(birth: DateOnly, on: DateOnly): number {
  let years = on.year - birth.year;
  if (on.month < birth.month || (on.month === birth.month && on.day < birth.day)) years -= 1;
  return years;
}

/** The next local midnight strictly after the given local date. */
export function endOfLocalDay(zone: TimeZoneId, date: DateOnly): Date {
  const next = addDays(date, 1);
  return instantOfLocal(zone, next.year, next.month, next.day, 0, 0, 0);
}

export function instantToIso(instant: Date): string {
  const whole = Math.floor(instant.getTime() / 1000) * 1000;
  return new Date(whole).toISOString().replace('.000Z', 'Z');
}

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
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
];

/** The display form of a local date, for example `Mon 15 Mar 2027`. */
export function displayDate(date: string): string {
  const parsed = parseDateOnly(date);
  if (!parsed) return date;
  const weekday = WEEKDAY_NAMES[isoWeekday(parsed) - 1] ?? '';
  return `${weekday} ${parsed.day} ${MONTH_NAMES[parsed.month - 1]} ${parsed.year}`;
}

export function displayDateOfInstant(iso: string, zone: TimeZoneId): string {
  return displayDate(localDate(new Date(iso), zone));
}

export function displayTimeOfInstant(iso: string, zone: TimeZoneId): string {
  return localTime(new Date(iso), zone);
}

/** `Mon 15 Mar 2027, 07:20 Denver time`. */
export function displayDateTime(iso: string, zone: TimeZoneId): string {
  return `${displayDateOfInstant(iso, zone)}, ${displayTimeOfInstant(iso, zone)} ${zoneLabel(zone)}`;
}
