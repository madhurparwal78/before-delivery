/** Job-local wall-clock times and their conversion to UTC with each date's own offset. */

export type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function toLocal(timeZone: string, utc: Date): LocalDateTime {
  const parts = formatterFor(timeZone).formatToParts(utc);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
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

function asUtcMillis(local: LocalDateTime): number {
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
}

function sameLocal(a: LocalDateTime, b: LocalDateTime): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

/**
 * The UTC instant for a job-local wall-clock time. A local time that does not exist
 * returns null; one that occurs twice returns its first occurrence.
 */
export function localToUtc(timeZone: string, local: LocalDateTime): Date | null {
  const target = asUtcMillis(local);
  const candidates = new Set<number>();
  for (const probe of [target - 26 * 3600_000, target, target + 26 * 3600_000]) {
    const offset = asUtcMillis(toLocal(timeZone, new Date(probe))) - probe;
    candidates.add(target - offset);
  }
  const matches = [...candidates]
    .filter((ms) => sameLocal(toLocal(timeZone, new Date(ms)), local))
    .sort((a, b) => a - b);
  return matches.length === 0 ? null : new Date(matches[0]);
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

export function parseLocalDateTime(text: unknown): LocalDateTime | null {
  if (typeof text !== 'string') return null;
  const m = LOCAL_RE.exec(text.trim());
  if (!m) return null;
  const value: LocalDateTime = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: m[6] ? Number(m[6]) : 0,
  };
  if (value.month < 1 || value.month > 12 || value.day < 1 || value.day > 31) return null;
  if (value.hour > 23 || value.minute > 59 || value.second > 59) return null;
  const check = new Date(Date.UTC(value.year, value.month - 1, value.day));
  if (check.getUTCMonth() + 1 !== value.month || check.getUTCDate() !== value.day) return null;
  return value;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseLocalDate(text: unknown): { year: number; month: number; day: number } | null {
  if (typeof text !== 'string') return null;
  const m = DATE_RE.exec(text.trim());
  if (!m) return null;
  const value = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const check = new Date(Date.UTC(value.year, value.month - 1, value.day));
  if (check.getUTCMonth() + 1 !== value.month || check.getUTCDate() !== value.day) return null;
  return value;
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatLocalDate(local: { year: number; month: number; day: number }): string {
  return `${local.year}-${pad2(local.month)}-${pad2(local.day)}`;
}

export function formatLocalDateTime(local: LocalDateTime): string {
  return `${formatLocalDate(local)}T${pad2(local.hour)}:${pad2(local.minute)}:${pad2(local.second)}`;
}

export function formatLocalMinutes(local: LocalDateTime): string {
  return `${formatLocalDate(local)} ${pad2(local.hour)}:${pad2(local.minute)}`;
}

/** Calendar-date arithmetic in the job's time zone, done without any instant. */
export function dayNumber(date: { year: number; month: number; day: number }): number {
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86400_000);
}

export function dateFromDayNumber(days: number): { year: number; month: number; day: number } {
  const d = new Date(days * 86400_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** 0 = Monday through 6 = Sunday. */
export function weekdayIndex(date: { year: number; month: number; day: number }): number {
  const dow = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return (dow + 6) % 7;
}

export const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

export function secondsOfDay(local: LocalDateTime): number {
  return local.hour * 3600 + local.minute * 60 + local.second;
}
