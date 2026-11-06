const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, found);
  }
  return found;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(timeZone: string, instant: Date): WallClock {
  const parts = formatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  const hour = read('hour');
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
    second: read('second'),
  };
}

function offsetMs(timeZone: string, instant: Date): number {
  const w = wallClock(timeZone, instant);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The date in the theatre's time zone, written YYYY-MM-DD. */
export function localDate(timeZone: string, instant: Date): string {
  const w = wallClock(timeZone, instant);
  return `${String(w.year).padStart(4, '0')}-${String(w.month).padStart(2, '0')}-${String(
    w.day,
  ).padStart(2, '0')}`;
}

/** The instant of 00:00 on the given local date in the given zone. */
export function startOfLocalDay(timeZone: string, date: string): Date {
  const guess = Date.parse(`${date}T00:00:00Z`);
  const first = offsetMs(timeZone, new Date(guess));
  let instant = guess - first;
  const second = offsetMs(timeZone, new Date(instant));
  if (second !== first) instant = guess - second;
  return new Date(instant);
}

export function addDays(date: string, days: number): string {
  const base = Date.parse(`${date}T00:00:00Z`) + days * DAY_MS;
  return new Date(base).toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to`, both written YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
}

/** The Monday of the week holding the given local date. */
export function mondayOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}
