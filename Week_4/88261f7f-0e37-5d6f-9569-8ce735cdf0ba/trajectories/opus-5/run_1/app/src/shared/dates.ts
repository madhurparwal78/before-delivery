/** A calendar date with no time or zone, written YYYY-MM-DD. */
export type PlainDate = string;

const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;

export function isPlainDate(value: unknown): value is PlainDate {
  if (typeof value !== 'string' || !DATE_TEXT.test(value)) return false;
  const utc = Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(5, 7)) - 1,
    Number(value.slice(8, 10)),
  );
  return formatPlainDate(utc) === value;
}

function formatPlainDate(utcMs: number): PlainDate {
  const date = new Date(utcMs);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function plainDateToUtcMs(date: PlainDate): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

const DAY_MS = 86400000;

export function addDays(date: PlainDate, days: number): PlainDate {
  return formatPlainDate(plainDateToUtcMs(date) + days * DAY_MS);
}

export function daysBetween(from: PlainDate, to: PlainDate): number {
  return Math.round((plainDateToUtcMs(to) - plainDateToUtcMs(from)) / DAY_MS);
}

export function dateRange(from: PlainDate, nights: number): PlainDate[] {
  const dates: PlainDate[] = [];
  for (let i = 0; i < nights; i += 1) dates.push(addDays(from, i));
  return dates;
}

/** 0 is Sunday through 6 is Saturday, taken from the date itself. */
export function weekday(date: PlainDate): number {
  return new Date(plainDateToUtcMs(date)).getUTCDay();
}

export function isWeekendNight(date: PlainDate): boolean {
  const day = weekday(date);
  return day === 5 || day === 6;
}
