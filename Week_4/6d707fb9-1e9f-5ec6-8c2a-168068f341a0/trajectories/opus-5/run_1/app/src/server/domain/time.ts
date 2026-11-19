export type Town = 'porto' | 'izmir' | 'hoChiMinhCity' | 'cairo';

export const LISBON = 'Europe/Lisbon';

export const TOWNS: Record<Town, { name: string; zone: string }> = {
  porto: { name: 'Porto', zone: 'Europe/Lisbon' },
  izmir: { name: 'Izmir', zone: 'Europe/Istanbul' },
  hoChiMinhCity: { name: 'Ho Chi Minh City', zone: 'Asia/Ho_Chi_Minh' },
  cairo: { name: 'Cairo', zone: 'Africa/Cairo' },
};

export function isTown(value: unknown): value is Town {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TOWNS, value);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
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

/** The wall-clock parts a zone shows at an instant given in whole seconds. */
function partsAt(seconds: number, zone: string): WallParts {
  const parts = formatter(zone).formatToParts(new Date(seconds * 1000));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
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

function wallAsUtcMs(seconds: number, zone: string): number {
  const p = partsAt(seconds, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

function offsetMs(seconds: number, zone: string): number {
  return wallAsUtcMs(seconds, zone) - seconds * 1000;
}

/**
 * Every instant, in whole seconds, a zone shows as the given wall time.
 * Empty when the clock change skips it, two when it happens twice.
 */
export function wallToInstants(wall: WallParts, zone: string): number[] {
  const target = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const probes = [target / 1000 - 93600, target / 1000 + 93600];
  const found: number[] = [];
  for (const probe of probes) {
    const candidate = Math.round((target - offsetMs(probe, zone)) / 1000);
    if (found.includes(candidate)) continue;
    if (wallAsUtcMs(candidate, zone) === target) found.push(candidate);
  }
  return found.sort((a, b) => a - b);
}

function startOfLocalDay(date: string, zone: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const found = wallToInstants({ year, month, day, hour: 0, minute: 0, second: 0 }, zone);
  if (found.length > 0) return found[0] as number;
  const noon = wallToInstants({ year, month, day, hour: 12, minute: 0, second: 0 }, zone);
  return (noon[0] as number) - 12 * 3600;
}

export function nextLocalDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return localDateOfUtcParts(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

function localDateOfUtcParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The hours in a day of a zone, 23 or 25 across a clock change. */
export function dayHours(date: string, zone: string): number {
  const start = startOfLocalDay(date, zone);
  const end = startOfLocalDay(nextLocalDate(date), zone);
  return Math.round((end - start) / 3600);
}

export function localDate(seconds: number, zone: string): string {
  const p = partsAt(seconds, zone);
  return localDateOfUtcParts(p.year, p.month, p.day);
}

export function localTime(seconds: number, zone: string): string {
  const p = partsAt(seconds, zone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** The published `Mon 29 Mar 2027` form on the local date of a zone. */
export function shownDate(seconds: number, zone: string): string {
  const p = partsAt(seconds, zone);
  const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()] as string;
  return `${weekday} ${String(p.day).padStart(2, '0')} ${MONTHS[p.month - 1] as string} ${p.year}`;
}

export function shownDateOfLocalDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] as string;
  return `${weekday} ${String(day).padStart(2, '0')} ${MONTHS[month - 1] as string} ${year}`;
}

export function iso(seconds: number): string {
  return `${new Date(Math.trunc(seconds) * 1000).toISOString().slice(0, 19)}Z`;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

const DATE_FORM = /^\d{4}-\d{2}-\d{2}$/;
const TIME_FORM = /^\d{2}:\d{2}$/;

export function isRealDate(date: string): boolean {
  if (!DATE_FORM.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const made = new Date(Date.UTC(year, month - 1, day));
  return made.getUTCFullYear() === year && made.getUTCMonth() + 1 === month && made.getUTCDate() === day;
}

export function isRealTime(time: string): boolean {
  if (!TIME_FORM.test(time)) return false;
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

/** The end of a local day, 23:59:59 wall time in the zone. */
export function endOfLocalDay(date: string, zone: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const found = wallToInstants({ year, month, day, hour: 23, minute: 59, second: 59 }, zone);
  if (found.length > 0) return found[found.length - 1] as number;
  return startOfLocalDay(nextLocalDate(date), zone) - 1;
}
