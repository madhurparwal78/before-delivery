const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    partsCache.set(timeZone, formatter);
  }
  return formatter;
}

function wallClockMs(instantMs: number, timeZone: string): number {
  const parts = partsFormatter(timeZone).formatToParts(new Date(instantMs));
  const pick = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const hour = pick('hour') % 24;
  return Date.UTC(pick('year'), pick('month') - 1, pick('day'), hour, pick('minute'), pick('second'));
}

function zoneOffsetMs(instantMs: number, timeZone: string): number {
  return wallClockMs(instantMs, timeZone) - instantMs;
}

/** The instant at which the given wall-clock time occurs in the given zone. */
export function zonedTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = target;
  for (let pass = 0; pass < 3; pass += 1) {
    instant = target - zoneOffsetMs(instant, timeZone);
  }
  return new Date(instant);
}

const displayFormatterCache = new Map<string, Intl.DateTimeFormat>();

/** The one display format for every `...Display` field. */
export function formatMuseumDisplay(instant: Date, timeZone: string): string {
  let formatter = displayFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    displayFormatterCache.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const hour = value('hour') === '24' ? '00' : value('hour');
  return `${value('weekday')} ${value('day')} ${value('month')} ${value('year')}, ${hour}:${value(
    'minute',
  )} museum time`;
}

export function isoDateParts(date: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Open hours: the open hours per day across every run day that is not a closed weekday. */
export function countOpenDays(runStart: string, runEnd: string, closedWeekdays: number[]): number {
  const start = isoDateParts(runStart);
  const end = isoDateParts(runEnd);
  if (!start || !end) return 0;
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  let open = 0;
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    if (!closedWeekdays.includes(new Date(ms).getUTCDay())) open += 1;
  }
  return open;
}

export function toIsoDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}
