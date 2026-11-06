import {
  formatLocalDate,
  formatLocalTime,
  isOpenDay,
  localDateOf,
  type LibraryCalendar,
  type LocalDate,
} from '../domain/calendar.js';
import { formatMoney } from '../domain/money.js';
import { HOLD_STATUS_WORDS, LOAN_STATUS_WORDS } from '../domain/states.js';
import type { HoldStatus, LoanStatus } from '../domain/states.js';
import type { LibrarySettings } from '../shared/api.js';
import type { SpanStatus } from '../domain/occupancy.js';

let calendar: LibraryCalendar | null = null;

export function rememberLibrary(settings: LibrarySettings): void {
  calendar = {
    timeZone: settings.time_zone,
    openDays: settings.open_days,
    closedDates: settings.closed_dates,
    openingTime: settings.opening_time,
    closingTime: settings.closing_time,
  };
}

function libraryCalendar(): LibraryCalendar {
  if (calendar === null) throw new Error('library settings not loaded');
  return calendar;
}

export function money(cents: number): string {
  return formatMoney(cents);
}

export function localTime(instant: string): string {
  return formatLocalTime(libraryCalendar(), new Date(instant));
}

export function shortDate(date: LocalDate): string {
  return formatLocalDate(libraryCalendar(), date);
}

export function todayLocal(): LocalDate {
  return localDateOf(libraryCalendar(), new Date());
}

export function openDay(date: LocalDate): boolean {
  return isOpenDay(libraryCalendar(), date);
}

export const SPAN_WORDS: Record<SpanStatus, string> = {
  held: 'Held',
  out: 'Out',
  overdue: 'Overdue',
};

export function holdWord(status: HoldStatus): string {
  return HOLD_STATUS_WORDS[status];
}

export function loanWord(status: LoanStatus): string {
  return LOAN_STATUS_WORDS[status];
}

/** The datetime-local value for an instant, in library time. */
export function localDateTimeValue(instant: Date): string {
  const zone = libraryCalendar().timeZone;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}T${pick('hour')}:${pick('minute')}`;
}

/** Reads a datetime-local value typed in library time back into an instant. */
export function instantFromLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const [date, time] = value.split('T');
  const zone = libraryCalendar().timeZone;
  const naive = Date.parse(`${date}T${time}:00Z`);
  const offsetAt = (instant: number): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(instant));
    const pick = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value ?? '0');
    return (
      Date.UTC(pick('year'), pick('month') - 1, pick('day'), pick('hour'), pick('minute'), pick('second')) -
      instant
    );
  };
  let guess = naive - offsetAt(naive);
  guess = naive - offsetAt(guess);
  return new Date(guess).toISOString();
}
