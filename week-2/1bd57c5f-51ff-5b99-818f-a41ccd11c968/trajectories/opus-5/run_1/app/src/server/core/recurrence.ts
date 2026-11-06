import {
  dateFromDayNumber,
  dayNumber,
  formatLocalDate,
  parseLocalDate,
  WEEKDAY_CODES,
  weekdayIndex,
  type WeekdayCode,
} from './timezone.js';

export const MAX_OCCURRENCES = 60;
export const MAX_SPAN_DAYS = 180;

export type RecurrenceFreq = 'daily' | 'weekly' | 'every_n_days';

export type Recurrence = {
  freq: RecurrenceFreq;
  weekdays: WeekdayCode[] | null;
  interval: number | null;
  until: string | null;
  count: number | null;
};

export type CalendarDate = { year: number; month: number; day: number };

function sortWeekdays(codes: WeekdayCode[]): WeekdayCode[] {
  return [...codes].sort((a, b) => WEEKDAY_CODES.indexOf(a) - WEEKDAY_CODES.indexOf(b));
}

/** Reads the recurrence rule. Every failure is one message on `recurrence`. */
export function readRecurrence(value: unknown, startDate: CalendarDate): Recurrence | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const freq = raw.freq;
  if (freq !== 'daily' && freq !== 'weekly' && freq !== 'every_n_days') return null;

  let weekdays: WeekdayCode[] | null = null;
  if (raw.weekdays !== undefined && raw.weekdays !== null) {
    if (freq !== 'weekly' || !Array.isArray(raw.weekdays)) return null;
    const codes: WeekdayCode[] = [];
    for (const entry of raw.weekdays) {
      if (typeof entry !== 'string') return null;
      if (!(WEEKDAY_CODES as readonly string[]).includes(entry)) return null;
      if (codes.includes(entry as WeekdayCode)) return null;
      codes.push(entry as WeekdayCode);
    }
    if (codes.length === 0) return null;
    weekdays = sortWeekdays(codes);
  }
  if (freq === 'weekly') {
    if (weekdays === null) return null;
    if (!weekdays.includes(WEEKDAY_CODES[weekdayIndex(startDate)])) return null;
  }

  let interval: number | null = null;
  if (raw.interval !== undefined && raw.interval !== null) {
    if (freq !== 'every_n_days') return null;
    if (typeof raw.interval !== 'number' || !Number.isInteger(raw.interval)) return null;
    interval = raw.interval;
  }
  if (freq === 'every_n_days') {
    if (interval === null || interval < 2 || interval > 30) return null;
  }

  const hasUntil = raw.until !== undefined && raw.until !== null;
  const hasCount = raw.count !== undefined && raw.count !== null;
  if (hasUntil === hasCount) return null;

  let until: string | null = null;
  if (hasUntil) {
    const parsed = parseLocalDate(raw.until);
    if (parsed === null) return null;
    if (dayNumber(parsed) < dayNumber(startDate)) return null;
    until = formatLocalDate(parsed);
  }

  let count: number | null = null;
  if (hasCount) {
    if (typeof raw.count !== 'number' || !Number.isInteger(raw.count)) return null;
    if (raw.count < 1 || raw.count > MAX_OCCURRENCES) return null;
    count = raw.count;
  }

  return { freq, weekdays, interval, until, count };
}

type Expansion = { days: number[] } | { problem: 'too_many' | 'too_long' };

/**
 * The occurrence dates of a rule, judged by calendar arithmetic alone. Generation stops
 * as soon as a limit is passed, so an oversized rule is never expanded.
 */
export function expandRecurrenceDates(startDate: CalendarDate, rule: Recurrence | null): Expansion {
  const first = dayNumber(startDate);
  if (rule === null) return { days: [first] };
  const untilDay = rule.until === null ? null : dayNumber(parseLocalDate(rule.until)!);
  const days: number[] = [];

  const push = (day: number): Expansion | null => {
    if (day - first > MAX_SPAN_DAYS) return { problem: 'too_long' };
    days.push(day);
    if (days.length > MAX_OCCURRENCES) return { problem: 'too_many' };
    return null;
  };

  const done = (): boolean => {
    if (rule.count !== null) return days.length >= rule.count;
    return false;
  };

  if (rule.freq === 'daily' || rule.freq === 'every_n_days') {
    const step = rule.freq === 'daily' ? 1 : rule.interval!;
    for (let day = first; ; day += step) {
      if (untilDay !== null && day > untilDay) break;
      const stop = push(day);
      if (stop) return stop;
      if (done()) break;
    }
  } else {
    const selected = rule.weekdays!.map((code) => WEEKDAY_CODES.indexOf(code));
    const startIndex = weekdayIndex(startDate);
    const weekStart = first - startIndex;
    for (let week = 0; ; week++) {
      for (const index of selected) {
        const day = weekStart + index + week * 7;
        if (day < first) continue;
        if (untilDay !== null && day > untilDay) continue;
        const stop = push(day);
        if (stop) return stop;
        if (done()) break;
      }
      if (done()) break;
      if (untilDay !== null && weekStart + week * 7 > untilDay) break;
    }
  }

  return { days };
}

export function dateTextOf(day: number): string {
  return formatLocalDate(dateFromDayNumber(day));
}

export function serialiseRecurrence(rule: Recurrence | null): Recurrence | null {
  if (rule === null) return null;
  return {
    freq: rule.freq,
    weekdays: rule.weekdays === null ? null : sortWeekdays(rule.weekdays),
    interval: rule.interval,
    until: rule.until,
    count: rule.count,
  };
}
