import type { Locale } from './types.js';

export const TIME_ZONE = 'America/Toronto';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const PART_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export type TorontoParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function torontoParts(instant: Date): TorontoParts {
  const parts = PART_FORMATTER.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    if (!found) throw new Error(`missing ${type}`);
    return Number(found.value);
  };
  // Intl renders midnight as hour 24 in some ICU builds; normalise it to 0.
  const hour = read('hour') % 24;
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
    second: read('second'),
  };
}

function partsAsUtcMs(parts: TorontoParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

export function torontoDate(instant: Date): string {
  const parts = torontoParts(instant);
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
}

export function torontoMonth(instant: Date): string {
  const parts = torontoParts(instant);
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}`;
}

export function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

export const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
export const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MONTH_ONLY = /^(\d{4})-(\d{2})$/;
export const TIME_ONLY = /^(\d{2}):(\d{2})$/;

export type LocalToUtc = { kind: 'instant'; instant: Date } | { kind: 'gap' };

/**
 * Turns a Toronto wall-clock stamp into an instant. A stamp inside the spring-forward gap has no
 * instant; a stamp that happens twice means its first (daylight-time) occurrence.
 */
export function torontoLocalToUtc(local: string): LocalToUtc {
  const match = LOCAL_DATE_TIME.exec(local);
  if (!match) throw new Error(`not a local stamp: ${local}`);
  const [, year, month, day, hour, minute] = match;
  const wall = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  for (const offsetHours of [4, 5]) {
    const candidate = new Date(wall + offsetHours * HOUR);
    if (partsAsUtcMs({ ...torontoParts(candidate), second: 0 }) === wall) {
      return { kind: 'instant', instant: candidate };
    }
  }
  return { kind: 'gap' };
}

export function startOfTorontoDay(date: string): Date {
  const resolved = torontoLocalToUtc(`${date}T00:00`);
  if (resolved.kind === 'gap') throw new Error(`no midnight on ${date}`);
  return resolved.instant;
}

export function isValidDateString(date: string): boolean {
  const match = DATE_ONLY.exec(date);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(date: string, days: number): string {
  const match = DATE_ONLY.exec(date);
  if (!match) throw new Error(`not a date: ${date}`);
  const shifted = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
  );
  return toDateString(shifted);
}

function toDateString(utc: Date): string {
  return `${pad(utc.getUTCFullYear(), 4)}-${pad(utc.getUTCMonth() + 1, 2)}-${pad(utc.getUTCDate(), 2)}`;
}

/** Steps whole months keeping the anchor day, falling back to a short month's last day. */
export function addMonthsOnAnchorDay(year: number, month: number, anchorDay: number, months: number): string {
  const total = month - 1 + months;
  const targetYear = year + Math.floor(total / 12);
  const targetMonth = (total % 12 + 12) % 12 + 1;
  const day = Math.min(anchorDay, daysInMonth(targetYear, targetMonth));
  return `${pad(targetYear, 4)}-${pad(targetMonth, 2)}-${pad(day, 2)}`;
}

export function dayOfWeek(date: string): number {
  const match = DATE_ONLY.exec(date);
  if (!match) throw new Error(`not a date: ${date}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

export function isBusinessDay(date: string): boolean {
  const day = dayOfWeek(date);
  return day >= 1 && day <= 5;
}

const MONTH_NAMES: Record<Locale, readonly string[]> = {
  'en-CA': [
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
  ],
  'fr-CA': [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre',
  ],
};

const WEEKDAY_NAMES: Record<Locale, readonly string[]> = {
  'en-CA': ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  'fr-CA': ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
};

function monthName(month: number, locale: Locale): string {
  const name = MONTH_NAMES[locale][month - 1];
  if (!name) throw new Error(`bad month ${month}`);
  return name;
}

function dayLabel(day: number, locale: Locale): string {
  return locale === 'fr-CA' && day === 1 ? '1er' : String(day);
}

/** "November 30, 2026" / "30 novembre 2026". */
export function formatLongDate(date: string, locale: Locale): string {
  const match = DATE_ONLY.exec(date);
  if (!match) throw new Error(`not a date: ${date}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (locale === 'fr-CA') return `${dayLabel(day, locale)} ${monthName(month, locale)} ${year}`;
  return `${monthName(month, locale)} ${day}, ${year}`;
}

/** Drop-time format, always read off the Toronto wall clock. */
export function formatDropTime(instant: Date, locale: Locale): string {
  const parts = torontoParts(instant);
  const weekday = WEEKDAY_NAMES[locale][dayOfWeek(torontoDate(instant))];
  if (!weekday) throw new Error('bad weekday');
  const minute = pad(parts.minute, 2);
  if (locale === 'fr-CA') {
    return `${weekday} ${dayLabel(parts.day, locale)} ${monthName(parts.month, locale)} ${parts.year} à ${parts.hour} h ${minute} (heure de Toronto)`;
  }
  return `${weekday}, ${monthName(parts.month, locale)} ${parts.day}, ${parts.year} at ${parts.hour}:${minute} (Toronto time)`;
}

/** The local stamp a date-and-time input shows for an instant. */
export function torontoLocalStamp(instant: Date): string {
  const parts = torontoParts(instant);
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}T${pad(parts.hour, 2)}:${pad(parts.minute, 2)}`;
}

export function torontoTimeOfDayMinutes(instant: Date): number {
  const parts = torontoParts(instant);
  return parts.hour * 60 + parts.minute;
}
