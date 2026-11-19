const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function zoneOffsetMs(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const field = (type: string): number =>
    Number.parseInt(parts.find((part) => part.type === type)?.value ?? '0', 10);
  const asUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour') % 24,
    field('minute'),
    field('second'),
  );
  return asUtc - instant.getTime();
}

/** The instant at which the given wall-clock time occurs in `timeZone`. */
export function zonedTimeToInstant(
  timeZone: string,
  year: number,
  month: number,
  day: number,
): Date {
  const guess = Date.UTC(year, month - 1, day);
  const offset = zoneOffsetMs(timeZone, new Date(guess - zoneOffsetMs(timeZone, new Date(guess))));
  return new Date(guess - offset);
}

export interface ZonedDate {
  year: number;
  month: number;
  day: number;
}

export function zonedDate(timeZone: string, instant: Date = new Date()): ZonedDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  const [year, month, day] = parts.split('-').map((value) => Number.parseInt(value, 10));
  return { year: year as number, month: month as number, day: day as number };
}

/** Midnight on the 1st up to, but not including, midnight on the next 1st, in the venue's zone. */
export function monthRange(timeZone: string, month: string): { start: Date; end: Date } {
  const year = Number.parseInt(month.slice(0, 4), 10);
  const index = Number.parseInt(month.slice(5), 10);
  const start = zonedTimeToInstant(timeZone, year, index, 1);
  const end =
    index === 12
      ? zonedTimeToInstant(timeZone, year + 1, 1, 1)
      : zonedTimeToInstant(timeZone, year, index + 1, 1);
  return { start, end };
}

export function startOfToday(timeZone: string): Date {
  const today = zonedDate(timeZone);
  return zonedTimeToInstant(timeZone, today.year, today.month, today.day);
}

export const currentMonth = (timeZone: string): string => {
  const today = zonedDate(timeZone);
  return `${today.year}-${String(today.month).padStart(2, '0')}`;
};

export function previousMonth(month: string): string {
  const year = Number.parseInt(month.slice(0, 4), 10);
  const index = Number.parseInt(month.slice(5), 10);
  return index === 1 ? `${year - 1}-12` : `${year}-${String(index - 1).padStart(2, '0')}`;
}

export const monthHasEnded = (timeZone: string, month: string): boolean =>
  monthRange(timeZone, month).end.getTime() <= Date.now();

/** `<Month YYYY>`, e.g. October 2026. */
export function monthLabel(month: string): string {
  const index = Number.parseInt(month.slice(5), 10);
  return `${MONTH_NAMES[index - 1] as string} ${month.slice(0, 4)}`;
}

/** Kill Bill's effective date as `D Month YYYY`. */
export function longDate(isoDate: string): string {
  const index = Number.parseInt(isoDate.slice(5, 7), 10);
  return `${Number.parseInt(isoDate.slice(8, 10), 10)} ${MONTH_NAMES[index - 1] as string} ${isoDate.slice(0, 4)}`;
}

export function formatInZone(timeZone: string, instant: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(instant);
}
