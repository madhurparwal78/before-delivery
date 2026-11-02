const BILLING_TIME_ZONE = 'America/Toronto';

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

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BILLING_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(instant: Date): ZonedParts {
  const found: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(instant)) {
    if (part.type !== 'literal') found[part.type] = part.value;
  }
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    hour: Number(found.hour),
    minute: Number(found.minute),
    second: Number(found.second),
  };
}

function zoneOffsetMs(instant: Date): number {
  const parts = zonedParts(instant);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - instant.getTime();
}

/** The calendar date, in America/Toronto, of an instant. */
export function billingDate(instant: Date): string {
  const parts = zonedParts(instant);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/** The instant of midnight at the start of a calendar date in America/Toronto. */
export function billingDayStart(date: string): Date {
  const naive = Date.parse(`${date}T00:00:00Z`);
  const firstGuess = naive - zoneOffsetMs(new Date(naive));
  return new Date(naive - zoneOffsetMs(new Date(firstGuess)));
}

function parseDateParts(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`not a calendar date: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Adds whole months to a calendar date, clamping to the end of the target month. */
export function addMonths(date: string, months: number): string {
  const { year, month, day } = parseDateParts(date);
  const zeroBased = month - 1 + months;
  const targetYear = year + Math.floor(zeroBased / 12);
  const targetMonth = ((zeroBased % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}


/** `November 30, 2026` */
export function formatLongDate(date: string): string {
  const { year, month, day } = parseDateParts(date);
  return `${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}

/** `November 30, 2026 at 23:45`, on the 24-hour clock in America/Toronto. */
export function formatLongDateAndTime(instant: Date): string {
  const parts = zonedParts(instant);
  const date = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  return `${formatLongDate(date)} at ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function isoTimestamp(instant: Date): string {
  return instant.toISOString().replace(/(\.\d{3})\d*Z$/, '$1Z');
}
