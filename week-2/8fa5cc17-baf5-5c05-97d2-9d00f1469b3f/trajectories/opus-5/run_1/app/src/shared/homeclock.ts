/** The single home of today's date on the home clock and of every shown time. */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
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
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const SHARE_LINK_MAX_DAYS = 90;

export function isTimeZone(name: unknown): name is string {
  if (typeof name !== 'string' || name.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

type Fields = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
  const hit = formatterCache.get(zone);
  if (hit !== undefined) return hit;
  const made = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(zone, made);
  return made;
}

export function fieldsInZone(instant: Date, zone: string): Fields {
  const parts = partsFormatter(zone).formatToParts(instant);
  const read = (type: string): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part === undefined ? 0 : Number(part.value);
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

export function zoneOffsetMs(instant: Date, zone: string): number {
  const fields = fieldsInZone(instant, zone);
  const asUtc = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export function dateInZone(instant: Date, zone: string): string {
  const fields = fieldsInZone(instant, zone);
  return `${String(fields.year).padStart(4, '0')}-${String(fields.month).padStart(2, '0')}-${String(fields.day).padStart(2, '0')}`;
}

export function todayInZone(zone: string, now: Date = new Date()): string {
  return dateInZone(now, zone);
}

export function localMinuteInZone(instant: Date, zone: string): string {
  const fields = fieldsInZone(instant, zone);
  return `${String(fields.year).padStart(4, '0')}-${String(fields.month).padStart(2, '0')}-${String(fields.day).padStart(2, '0')}T${String(fields.hour).padStart(2, '0')}:${String(fields.minute).padStart(2, '0')}`;
}

export type LocalMinuteResult = { ok: true; instant: Date } | { ok: false; reason: 'gap' };

/** Convert a whole minute on the home clock to a UTC instant, once. */
export function localMinuteToInstant(local: string, zone: string): LocalMinuteResult {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (match === null) return { ok: false, reason: 'gap' };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
  const candidates: number[] = [];
  for (const probe of [wanted, wanted - 86_400_000, wanted + 86_400_000]) {
    const offset = zoneOffsetMs(new Date(probe), zone);
    const candidate = wanted - offset;
    if (candidates.includes(candidate)) continue;
    if (localMinuteInZone(new Date(candidate), zone) === local) candidates.push(candidate);
  }
  if (candidates.length === 0) return { ok: false, reason: 'gap' };
  return { ok: true, instant: new Date(Math.min(...candidates)) };
}

/** `Thursday 29 October 2026` */
export function dateHeading(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return date;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday} ${day} ${MONTHS[month - 1]} ${year}`;
}

/** `29 Oct 2026, 18:30` */
export function shortStamp(instant: Date, zone: string): string {
  const fields = fieldsInZone(instant, zone);
  return `${fields.day} ${MONTHS_SHORT[fields.month - 1]} ${fields.year}, ${String(fields.hour).padStart(2, '0')}:${String(fields.minute).padStart(2, '0')}`;
}

/** `29 Oct 2026, 18:30 Europe/London` */
export function expiresDisplay(instant: Date, zone: string): string {
  return `${shortStamp(instant, zone)} ${zone}`;
}

export function addDaysToDate(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return date;
  const stamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + days * 86_400_000;
  const moved = new Date(stamp);
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, '0')}-${String(moved.getUTCDate()).padStart(2, '0')}`;
}
