const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
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

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return Number(part ? part.value : 0);
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

function offsetMinutes(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000;
}

export function instantFromLocal(parts: LocalParts, timeZone: string): Date {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let guess = naive - offsetMinutes(new Date(naive), timeZone) * 60000;
  guess = naive - offsetMinutes(new Date(guess), timeZone) * 60000;
  return new Date(guess);
}

export function parseDate(value: string): LocalParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day, hour: 0, minute: 0, second: 0 };
}

/** The exclusive boundary: 00:00:00 local on the day after `date`. */
export function cutoffInstant(date: string, timeZone: string): Date {
  const parts = parseDate(date);
  if (!parts) throw new Error(`Not a date: ${date}`);
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return instantFromLocal(
    {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
    },
    timeZone,
  );
}

export function isOpen(date: string, timeZone: string, now: Date): boolean {
  return now.getTime() < cutoffInstant(date, timeZone).getTime();
}

function offsetSuffix(instant: Date, timeZone: string): string {
  const minutes = offsetMinutes(instant, timeZone);
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export function withOffset(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    offsetSuffix(instant, timeZone)
  );
}

export function dateLabel(date: string, timeZone: string): string {
  const parts = parseDate(date);
  if (!parts) throw new Error(`Not a date: ${date}`);
  return `23:59 ${timeZone}, ${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;
}

export function momentLabel(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(p.hour)}:${pad(p.minute)} ${timeZone}, ${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

export function toIsoUtc(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}
