/** Time-zone and civil-calendar arithmetic. Real IANA rules only, never fixed offsets. */

export type CivilDate = { year: number; month: number; day: number };
export type CivilDateTime = CivilDate & { hour: number; minute: number; second: number };

export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();
const partFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(zone: string): Intl.DateTimeFormat {
  let f = offsetFormatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
    offsetFormatters.set(zone, f);
  }
  return f;
}

function partFormatter(zone: string): Intl.DateTimeFormat {
  let f = partFormatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partFormatters.set(zone, f);
  }
  return f;
}

/** Offset of `zone` from UTC in minutes at the given instant (east positive). */
function zoneOffsetMinutes(zone: string, instantMs: number): number {
  const parts = offsetFormatter(zone).formatToParts(new Date(instantMs));
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? '0'));
}

/** Wall-clock fields of `zone` at the given instant. */
export function instantToZoned(zone: string, instantMs: number): CivilDateTime {
  const parts = partFormatter(zone).formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const hour = get('hour');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: hour === 24 ? 0 : hour,
    minute: get('minute'),
    second: get('second'),
  };
}

export type ZonedResolution =
  | { kind: 'ok'; instantMs: number }
  | { kind: 'gap' };

/**
 * Resolves an office-local date-time to an instant. A time inside a
 * spring-forward gap resolves to `gap`; a repeated autumn time resolves to its
 * first occurrence.
 */
export function zonedToInstant(zone: string, local: CivilDateTime): ZonedResolution {
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  const candidates: number[] = [];
  for (const probe of [asUtc, asUtc - 12 * 3600_000, asUtc + 12 * 3600_000]) {
    const candidate = asUtc - zoneOffsetMinutes(zone, probe) * 60_000;
    if (!candidates.includes(candidate)) candidates.push(candidate);
  }
  const valid = candidates
    .filter((c) => sameCivil(instantToZoned(zone, c), local))
    .sort((a, b) => a - b);
  if (valid.length === 0) return { kind: 'gap' };
  return { kind: 'ok', instantMs: valid[0] };
}

function sameCivil(a: CivilDateTime, b: CivilDateTime): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day
    && a.hour === b.hour && a.minute === b.minute && a.second === b.second;
}

/** The instant at which the given office-local day starts. */
export function startOfDayInstant(zone: string, date: CivilDate): number {
  for (let hour = 0; hour < 4; hour += 1) {
    const resolved = zonedToInstant(zone, { ...date, hour, minute: 0, second: 0 });
    if (resolved.kind === 'ok') return resolved.instantMs;
  }
  throw new Error(`cannot resolve start of ${formatIsoDate(date)} in ${zone}`);
}

export function officeDate(zone: string, instantMs: number): CivilDate {
  const z = instantToZoned(zone, instantMs);
  return { year: z.year, month: z.month, day: z.day };
}

export function dayNumber(date: CivilDate): number {
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86_400_000);
}

function fromDayNumber(days: number): CivilDate {
  const d = new Date(days * 86_400_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function addDays(date: CivilDate, amount: number): CivilDate {
  return fromDayNumber(dayNumber(date) + amount);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: CivilDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function isWeekend(date: CivilDate): boolean {
  const w = weekday(date);
  return w === 0 || w === 6;
}

export function compareDates(a: CivilDate, b: CivilDate): number {
  return dayNumber(a) - dayNumber(b);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Month arithmetic that clamps to the last day of a shorter target month. */
export function addMonthsClamped(date: CivilDate, months: number): CivilDate {
  const total = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

export function formatIsoDate(date: CivilDate): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

export function parseIsoDate(value: string): CivilDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  if (date.month < 1 || date.month > 12) return null;
  if (date.day < 1 || date.day > daysInMonth(date.year, date.month)) return null;
  return date;
}

export function parseLocalDateTime(value: string): CivilDateTime | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const date = parseIsoDate(`${m[1]}-${m[2]}-${m[3]}`);
  if (!date) return null;
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] ?? '0');
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { ...date, hour, minute, second };
}

export function toIsoInstant(instantMs: number): string {
  return `${new Date(Math.floor(instantMs / 1000) * 1000).toISOString().slice(0, 19)}Z`;
}

export function parseMonthKey(value: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(m[1]), month };
}
