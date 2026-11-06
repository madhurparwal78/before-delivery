/**
 * The 2026 session calendar and the holdings week. Session open or closed is
 * decided here and nowhere else, so the board, the release dialog preview, the
 * tick endpoint and close processing all agree.
 */
import {
  CalendarDate,
  addDays,
  dateAtTime,
  formatDateString,
  newYorkDateOf,
  parseDateString,
  weekdayOf,
} from '../shared/nytime';

export const HOLIDAYS_2026: Readonly<Record<string, string>> = {
  '2026-01-01': "New Year's Day",
  '2026-01-19': 'Martin Luther King Jr. Day',
  '2026-02-16': "Washington's Birthday",
  '2026-04-03': 'Good Friday',
  '2026-05-25': 'Memorial Day',
  '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day (observed)',
  '2026-09-07': 'Labor Day',
  '2026-11-26': 'Thanksgiving Day',
  '2026-12-25': 'Christmas Day',
};

const EARLY_CLOSE_DATES: ReadonlySet<string> = new Set(['2026-11-27', '2026-12-24']);

export interface SessionDay {
  date: CalendarDate;
  tradingDay: boolean;
  holiday: string | null;
  earlyClose: boolean;
  /** Inclusive session open instant, null when the market does not trade. */
  opensAt: number | null;
  /** Exclusive session close instant, null when the market does not trade. */
  closesAt: number | null;
}

export function sessionDayFor(date: CalendarDate): SessionDay {
  const key = formatDateString(date);
  const weekday = weekdayOf(date);
  const holiday = HOLIDAYS_2026[key] ?? null;
  const weekend = weekday === 0 || weekday === 6;
  const tradingDay = !weekend && holiday === null;
  const earlyClose = tradingDay && EARLY_CLOSE_DATES.has(key);
  if (!tradingDay) {
    return { date, tradingDay: false, holiday, earlyClose: false, opensAt: null, closesAt: null };
  }
  return {
    date,
    tradingDay: true,
    holiday: null,
    earlyClose,
    opensAt: dateAtTime(date, 9, 30, 0),
    closesAt: earlyClose ? dateAtTime(date, 13, 0, 0) : dateAtTime(date, 16, 0, 0),
  };
}

export function sessionDayForString(dateString: string): SessionDay | null {
  const date = parseDateString(dateString);
  if (!date) return null;
  return sessionDayFor(date);
}

/** The regular session runs 09:30:00 inclusive to its close exclusive. */
export function isSessionOpenAt(epochMs: number): boolean {
  const day = sessionDayFor(newYorkDateOf(epochMs));
  if (!day.tradingDay || day.opensAt === null || day.closesAt === null) return false;
  return epochMs >= day.opensAt && epochMs < day.closesAt;
}

/** Today's close instant while the session is open, otherwise null. */
export function closesAtIfOpen(epochMs: number): number | null {
  const day = sessionDayFor(newYorkDateOf(epochMs));
  if (!day.tradingDay || day.opensAt === null || day.closesAt === null) return null;
  if (epochMs >= day.opensAt && epochMs < day.closesAt) return day.closesAt;
  return null;
}

/** Trading days whose close instant is at or before `epochMs`, in date order. */
export function closesUpTo(from: CalendarDate, epochMs: number): SessionDay[] {
  const days: SessionDay[] = [];
  let cursor = from;
  for (let guard = 0; guard < 4000; guard += 1) {
    if (dateAtTime(cursor, 0, 0, 0) > epochMs) break;
    const day = sessionDayFor(cursor);
    if (day.closesAt !== null && day.closesAt <= epochMs) days.push(day);
    cursor = addDays(cursor, 1);
  }
  return days;
}

// --- The holdings week: Monday 00:00:00 to Sunday 23:59:59 New York. ---

export function isSunday(date: CalendarDate): boolean {
  return weekdayOf(date) === 0;
}

export function weekStartInstant(weekEnding: CalendarDate): number {
  return dateAtTime(addDays(weekEnding, -6), 0, 0, 0);
}

/** The Sunday 23:59:59 instant that every exhibit input of that week carries. */
export function weekEndInstant(weekEnding: CalendarDate): number {
  return dateAtTime(weekEnding, 23, 59, 59);
}

export function nextWeekEnding(weekEnding: CalendarDate): CalendarDate {
  return addDays(weekEnding, 7);
}

/** True when `date` falls in the Monday-to-Sunday span of that week. */
export function isWithinWeek(weekEnding: CalendarDate, date: CalendarDate): boolean {
  const start = formatDateString(addDays(weekEnding, -6));
  const end = formatDateString(weekEnding);
  const value = formatDateString(date);
  return value >= start && value <= end;
}
