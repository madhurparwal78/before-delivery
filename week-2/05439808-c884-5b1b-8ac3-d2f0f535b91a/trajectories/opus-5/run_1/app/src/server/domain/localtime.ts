const formatters = new Map<string, Intl.DateTimeFormat>();

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_MS = 86_400_000;

export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

function formatterFor(zone: string): Intl.DateTimeFormat {
  const cached = formatters.get(zone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short'
  });
  formatters.set(zone, created);
  return created;
}

export function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function localParts(zone: string, at: Date): LocalParts {
  const parts = formatterFor(zone).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '0';
  return {
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    hour: Number(read('hour')),
    minute: Number(read('minute')),
    second: Number(read('second')),
    weekday: WEEKDAYS.indexOf(read('weekday')) + 1
  };
}

function dateNumber(parts: { year: number; month: number; day: number }): number {
  return parts.year * 10000 + parts.month * 100 + parts.day;
}

function startOfLocalDate(zone: string, year: number, month: number, day: number): Date {
  const target = year * 10000 + month * 100 + day;
  const centre = Date.UTC(year, month - 1, day);
  let low = centre - 2 * DAY_MS;
  let high = centre + 2 * DAY_MS;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (dateNumber(localParts(zone, new Date(middle))) >= target) high = middle;
    else low = middle + 1;
  }
  return new Date(low);
}

export function localDayStart(zone: string, at: Date): Date {
  const parts = localParts(zone, at);
  return startOfLocalDate(zone, parts.year, parts.month, parts.day);
}

export function nextLocalDayStart(zone: string, at: Date): Date {
  const parts = localParts(zone, at);
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + DAY_MS);
  return startOfLocalDate(zone, next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

export function localWeekStart(zone: string, at: Date): Date {
  const parts = localParts(zone, at);
  const shifted = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day) - (parts.weekday - 1) * DAY_MS
  );
  return startOfLocalDate(
    zone,
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate()
  );
}

export function nextLocalWeekStart(zone: string, at: Date): Date {
  const parts = localParts(zone, localWeekStart(zone, at));
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + 7 * DAY_MS);
  return startOfLocalDate(
    zone,
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate()
  );
}
