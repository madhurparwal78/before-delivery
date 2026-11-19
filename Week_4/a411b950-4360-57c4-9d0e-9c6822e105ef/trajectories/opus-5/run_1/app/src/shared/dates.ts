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
] as const;

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const made = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  formatters.set(timeZone, made);
  return made;
}

export function wallClockIn(instant: Date, timeZone: string): WallClock {
  const parts = formatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return Number(part?.value ?? '0');
  };
  const hour = read('hour');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
  };
}

function pad(value: number, width: number): string {
  return value.toString().padStart(width, '0');
}

/** `9 November 2026, 14:05` */
export function formatDateTime(instant: Date, timeZone: string): string {
  const clock = wallClockIn(instant, timeZone);
  return `${clock.day} ${MONTH_NAMES[clock.month - 1]} ${clock.year}, ${pad(clock.hour, 2)}:${pad(clock.minute, 2)}`;
}

/** `9 November 2026` from a `YYYY-MM-DD` calendar date. */
export function formatIsoCalendarDate(date: string): string {
  const parts = date.split('-');
  const month = Number(parts[1] ?? '1');
  return `${Number(parts[2] ?? '1')} ${MONTH_NAMES[month - 1]} ${parts[0] ?? ''}`;
}

/** The operator's local calendar date, `YYYY-MM-DD`. */
export function businessDate(instant: Date, timeZone: string): string {
  const clock = wallClockIn(instant, timeZone);
  return `${pad(clock.year, 4)}-${pad(clock.month, 2)}-${pad(clock.day, 2)}`;
}

/** The operator's current calendar month, `YYYY-MM`. */
export function businessMonth(instant: Date, timeZone: string): string {
  const clock = wallClockIn(instant, timeZone);
  return `${pad(clock.year, 4)}-${pad(clock.month, 2)}`;
}

export function isMonthKey(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5));
  return month >= 1 && month <= 12;
}

/** `March 2027` */
export function monthLabel(month: string): string {
  const index = Number(month.slice(5)) - 1;
  return `${MONTH_NAMES[index]} ${month.slice(0, 4)}`;
}

export function addMonths(month: string, count: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5)) - 1 + count;
  const shiftedYear = year + Math.floor(index / 12);
  const shiftedMonth = ((index % 12) + 12) % 12;
  return `${pad(shiftedYear, 4)}-${pad(shiftedMonth + 1, 2)}`;
}

export function isTimeZone(value: string): boolean {
  return Intl.supportedValuesOf('timeZone').includes(value);
}
