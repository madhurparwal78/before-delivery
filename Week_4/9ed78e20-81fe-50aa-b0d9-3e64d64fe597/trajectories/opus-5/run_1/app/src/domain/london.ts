export const LONDON = 'Europe/London';

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
] as const;

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function londonWallClock(instant: Date): WallClock {
  const parts = partsFormatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found === undefined ? 0 : Number.parseInt(found.value, 10);
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

function offsetMinutes(instant: Date): number {
  const wall = londonWallClock(instant);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000;
}

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export type WallClockParse =
  | { readonly kind: 'ok'; readonly instant: Date }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'nonexistent' };

/** Reads a Europe/London wall-clock time as an instant. */
export function londonLocalToInstant(value: string): WallClockParse {
  const match = LOCAL_PATTERN.exec(value.trim());
  if (match === null) return { kind: 'malformed' };
  const [, y, mo, d, h, mi, s] = match;
  const year = Number.parseInt(y as string, 10);
  const month = Number.parseInt(mo as string, 10);
  const day = Number.parseInt(d as string, 10);
  const hour = Number.parseInt(h as string, 10);
  const minute = Number.parseInt(mi as string, 10);
  const second = s === undefined ? 0 : Number.parseInt(s, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return { kind: 'malformed' };
  if (hour > 23 || minute > 59 || second > 59) return { kind: 'malformed' };
  if (!isRealDate(year, month, day)) return { kind: 'malformed' };

  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const candidates = new Set<number>();
  for (const probe of [naive, naive - 3_600_000, naive + 3_600_000]) {
    const offset = offsetMinutes(new Date(probe));
    candidates.add(naive - offset * 60_000);
  }
  const valid: number[] = [];
  for (const candidate of candidates) {
    const wall = londonWallClock(new Date(candidate));
    if (
      wall.year === year &&
      wall.month === month &&
      wall.day === day &&
      wall.hour === hour &&
      wall.minute === minute &&
      wall.second === second
    ) {
      valid.push(candidate);
    }
  }
  if (valid.length === 0) return { kind: 'nonexistent' };
  // An ambiguous wall clock (clocks going back) means the earlier occurrence, in BST.
  return { kind: 'ok', instant: new Date(Math.min(...valid)) };
}

export function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
  );
}

export function isRealDateString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  return isRealDate(
    Number.parseInt(match[1] as string, 10),
    Number.parseInt(match[2] as string, 10),
    Number.parseInt(match[3] as string, 10),
  );
}

/** "<D Month YYYY, HH:mm>" in London time. */
export function formatLondonDateTime(instant: Date): string {
  const wall = londonWallClock(instant);
  const hh = String(wall.hour).padStart(2, '0');
  const mm = String(wall.minute).padStart(2, '0');
  return `${wall.day} ${MONTHS[wall.month - 1]} ${wall.year}, ${hh}:${mm}`;
}

/** "<D Month YYYY>" for a plain calendar date such as an evaluation date. */
export function formatCalendarDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match === null) return value;
  const year = Number.parseInt(match[1] as string, 10);
  const month = Number.parseInt(match[2] as string, 10);
  const day = Number.parseInt(match[3] as string, 10);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Today's date in London as YYYY-MM-DD. */
export function londonToday(now: Date = new Date()): string {
  const wall = londonWallClock(now);
  return `${String(wall.year).padStart(4, '0')}-${String(wall.month).padStart(2, '0')}-${String(
    wall.day,
  ).padStart(2, '0')}`;
}
