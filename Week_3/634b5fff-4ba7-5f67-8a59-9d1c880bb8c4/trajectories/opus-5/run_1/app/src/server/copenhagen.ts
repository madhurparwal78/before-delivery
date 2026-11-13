export const COPENHAGEN = 'Europe/Copenhagen';

const partFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: COPENHAGEN,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Formatted from the whole second, since the formatter rounds fractions up. */
export function partsInCopenhagen(instant: Date): ZonedParts {
  const whole = new Date(Math.floor(instant.getTime() / 1000) * 1000);
  const found: Record<string, string> = {};
  for (const part of partFormatter.formatToParts(whole)) {
    found[part.type] = part.value;
  }
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    hour: Number(found.hour) % 24,
    minute: Number(found.minute),
    second: Number(found.second),
  };
}

function offsetMsAt(instant: number): number {
  const whole = Math.floor(instant / 1000) * 1000;
  const p = partsInCopenhagen(new Date(whole));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - whole;
}

/** The instant at which Copenhagen wall-clock time reads the given parts. */
export function copenhagenToInstant(parts: ZonedParts, millisecond = 0): Date {
  const naive = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    millisecond,
  );
  let instant = naive - offsetMsAt(naive);
  instant = naive - offsetMsAt(instant);
  return new Date(instant);
}

export function offsetSuffix(instant: Date): string {
  const minutes = offsetMsAt(instant.getTime()) / 60000;
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Copenhagen local time with its offset, as published for transfer deadlines. */
export function formatCopenhagenLocal(instant: Date): string {
  const p = partsInCopenhagen(instant);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${offsetSuffix(instant)}`;
}

/** The Copenhagen calendar month, as YYYY-MM, in which an instant falls. */
export function copenhagenMonth(instant: Date): string {
  const p = partsInCopenhagen(instant);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

export function monthBounds(month: string): { start: Date; end: Date } {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const start = copenhagenToInstant({ year, month: monthNumber, day: 1, hour: 0, minute: 0, second: 0 });
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const end = copenhagenToInstant({ year: nextYear, month: nextMonth, day: 1, hour: 0, minute: 0, second: 0 });
  return { start, end };
}

const BANK_HOLIDAYS = new Set(['12-24', '12-25', '12-26', '12-31', '01-01']);

function isBankingDay(year: number, month: number, day: number): boolean {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !BANK_HOLIDAYS.has(`${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
}

/**
 * The transfer deadline: 23:59:59 Copenhagen, inclusive, on the third banking
 * day after the order's Copenhagen date.
 */
export function thirdBankingDayDeadline(orderInstant: Date): Date {
  const from = partsInCopenhagen(orderInstant);
  const cursor = new Date(Date.UTC(from.year, from.month - 1, from.day));
  let counted = 0;
  while (counted < 3) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isBankingDay(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate())) {
      counted += 1;
    }
  }
  return copenhagenToInstant(
    {
      year: cursor.getUTCFullYear(),
      month: cursor.getUTCMonth() + 1,
      day: cursor.getUTCDate(),
      hour: 23,
      minute: 59,
      second: 59,
    },
    999,
  );
}

export const EDITION_CLOSES_AT = copenhagenToInstant({
  year: 2027,
  month: 2,
  day: 1,
  hour: 0,
  minute: 0,
  second: 0,
});
