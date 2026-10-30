/** Wall-clock arithmetic in an hour's own time zone, including the two clock-change cases. */

export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, found);
  }
  return found;
}

interface WallClock extends LocalDate {
  hour: number;
  minute: number;
  second: number;
}

function wallClock(zone: string, instant: Date): WallClock {
  const parts = formatter(zone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return Number(part!.value);
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

function offsetMillis(zone: string, instant: Date): number {
  const wall = wallClock(zone, instant);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export function localDateOf(zone: string, instant: Date): LocalDate {
  const wall = wallClock(zone, instant);
  return { year: wall.year, month: wall.month, day: wall.day };
}

export function dateKey(date: LocalDate): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

export function parseDateKey(key: string): LocalDate {
  const [year, month, day] = key.split('-').map((part) => Number(part));
  return { year: year!, month: month!, day: day! };
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  const left = dateKey(a);
  const right = dateKey(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The instant at which a local wall-clock time happens, or null when the clocks
 * spring over it. When it happens twice, the first occurrence is returned.
 */
function instantOf(zone: string, date: LocalDate, hour: number, minute: number): Date | null {
  const wanted = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const candidates = new Set<number>();
  const first = wanted - offsetMillis(zone, new Date(wanted));
  candidates.add(first);
  candidates.add(wanted - offsetMillis(zone, new Date(first)));
  const valid: number[] = [];
  for (const candidate of candidates) {
    const wall = wallClock(zone, new Date(candidate));
    if (
      wall.year === date.year &&
      wall.month === date.month &&
      wall.day === date.day &&
      wall.hour === hour &&
      wall.minute === minute
    ) {
      valid.push(candidate);
    }
  }
  if (valid.length === 0) return null;
  return new Date(Math.min(...valid));
}

export interface LocalStart {
  /** The instant the hour starts, and so the instant its reminder is due. */
  at: Date;
  /** The local time it starts at, which moves forward over a spring-forward gap. */
  localTime: string;
}

const time = (hour: number, minute: number): string =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

/**
 * When a night's hour starts: the local time on that date, moved to the first valid
 * minute after it if the clocks spring over it, and taken once if it happens twice.
 */
export function localStartOfNight(zone: string, night: LocalDate, startsAtLocal: string): LocalStart {
  const [startHour, startMinute] = startsAtLocal.split(':').map((part) => Number(part));
  let minuteOfDay = startHour! * 60 + startMinute!;
  for (let step = 0; step < 24 * 60; step += 1) {
    const hour = Math.floor((minuteOfDay % (24 * 60)) / 60);
    const minute = minuteOfDay % 60;
    const date = minuteOfDay >= 24 * 60 ? addDays(night, 1) : night;
    const at = instantOf(zone, date, hour, minute);
    if (at) return { at, localTime: time(hour, minute) };
    minuteOfDay += 1;
  }
  throw new Error(`no valid local start in ${zone}`);
}
