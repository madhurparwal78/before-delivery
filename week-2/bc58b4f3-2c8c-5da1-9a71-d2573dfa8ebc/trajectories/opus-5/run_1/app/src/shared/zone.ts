export const AGENCY_ZONE = 'America/Chicago';

export const DAY_COLUMN_START_MINUTE = 6 * 60;
export const DAY_COLUMN_END_MINUTE = 22 * 60;

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 1 = Monday … 7 = Sunday */
  weekday: number;
}

const PART_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: AGENCY_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: AGENCY_ZONE,
  weekday: 'short',
});

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

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

function numericParts(instant: Date): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const parts = PART_FORMATTER.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    if (!found) {
      throw new Error(`missing ${type} part`);
    }
    return Number(found.value);
  };
  return { y: read('year'), mo: read('month'), d: read('day'), h: read('hour'), mi: read('minute'), s: read('second') };
}

/** Offset of the agency zone from UTC, in milliseconds, at the given instant. */
function zoneOffsetMs(instant: Date): number {
  const { y, mo, d, h, mi, s } = numericParts(instant);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s, instant.getUTCMilliseconds());
  return asUtc - instant.getTime();
}

export function partsOf(instant: Date): ZonedParts {
  const { y, mo, d, h, mi } = numericParts(instant);
  const weekdayName = WEEKDAY_FORMATTER.format(instant);
  const weekday = WEEKDAY_INDEX[weekdayName];
  if (weekday === undefined) {
    throw new Error(`unknown weekday ${weekdayName}`);
  }
  return { year: y, month: mo, day: d, hour: h, minute: mi, weekday };
}

/** The instant at which the agency-zone wall clock reads the given date and time. */
export function instantOf(year: number, month: number, day: number, hour: number, minute: number): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidate = naive - zoneOffsetMs(new Date(naive));
  candidate = naive - zoneOffsetMs(new Date(candidate));
  return new Date(candidate);
}

/** Monday 00:00 agency time of the week containing the instant. */
export function startOfAgencyWeek(instant: Date): Date {
  const parts = partsOf(instant);
  return instantOf(parts.year, parts.month, parts.day - (parts.weekday - 1), 0, 0);
}

export function agencyDateString(instant: Date): string {
  const p = partsOf(instant);
  return `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function agencyTimeString(instant: Date): string {
  const p = partsOf(instant);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

export function agencyMinuteOfDay(instant: Date): number {
  const p = partsOf(instant);
  return p.hour * 60 + p.minute;
}

export function parseDateString(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const probe = instantOf(year, month, day, 12, 0);
  const parts = partsOf(probe);
  if (parts.year !== year || parts.month !== month || parts.day !== day) {
    return null;
  }
  return { year, month, day };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function pad4(value: number): string {
  return String(value).padStart(4, '0');
}

/** `2026-11-12T09:00:00-06:00` — ISO 8601 carrying the agency-zone offset. */
export function toAgencyIso(instant: Date): string {
  const p = partsOf(instant);
  const offsetMinutes = zoneOffsetMs(instant) / 60000;
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return (
    `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}:00` +
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  );
}

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function weekdayName(parts: ZonedParts): string {
  const name = WEEKDAY_NAMES[parts.weekday - 1];
  if (name === undefined) {
    throw new Error(`unknown weekday index ${parts.weekday}`);
  }
  return name;
}

function monthName(parts: ZonedParts): string {
  const name = MONTH_NAMES[parts.month - 1];
  if (name === undefined) {
    throw new Error(`unknown month ${parts.month}`);
  }
  return name;
}

/** `Thu 12 Nov 09:00` */
export function formatAgencyDateTime(instant: Date): string {
  const p = partsOf(instant);
  return `${weekdayName(p)} ${p.day} ${monthName(p)} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** `Thu 12 Nov 09:00–10:30` */
export function formatAgencyRange(start: Date, end: Date): string {
  const e = partsOf(end);
  return `${formatAgencyDateTime(start)}–${pad2(e.hour)}:${pad2(e.minute)}`;
}

/** `Thu 12 Nov` */
export function formatAgencyDate(instant: Date): string {
  const p = partsOf(instant);
  return `${weekdayName(p)} ${p.day} ${monthName(p)}`;
}

/** `Mon 9 Nov 2026` */
export function formatAgencyDateWithYear(instant: Date): string {
  const p = partsOf(instant);
  return `${weekdayName(p)} ${p.day} ${monthName(p)} ${p.year}`;
}

/** `Mon 9` — day tab label */
export function formatAgencyDayTab(instant: Date): string {
  const p = partsOf(instant);
  return `${weekdayName(p)} ${p.day}`;
}

/** `1:30` */
export function formatHoursMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}:${pad2(totalMinutes % 60)}`;
}

/** `1 h 30 m` */
export function formatSpokenDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  return `${hours} h ${pad2(totalMinutes % 60)} m`;
}

/** `$1,343.00` */
export function formatDollars(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const fraction = pad2(abs % 100);
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${fraction}`;
}
