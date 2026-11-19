import { DateTime } from 'luxon';
import { PRACTICE_ZONE, periodStart, firstDayOfPeriod, type Frequency } from '../../shared/periods.js';
import { editionInEffect, nominalDueDate, carryForward, deadlineInstant } from '../../shared/deadlines.js';

export interface EditionRow {
  effective_date: string;
  due_day: number;
  carry: 'next_business' | 'fixed';
  rate: string;
  extension_days: number;
}

export interface StateRow {
  code: string;
  name: string;
  zone: string;
  holidays: string[];
  editions: EditionRow[];
}

export interface DueComputation {
  edition: EditionRow;
  unextended_nominal_date: string;
  due_date: string;
  carried_from: string | null;
  due_at: Date;
}

/** One place that computes a return's due date from its period, edition and carry rule. */
export function computeDue(
  state: StateRow,
  period: string,
  frequency: Frequency,
  extensionDaysUsed: number | null,
): DueComputation {
  const after = monthAfterPeriod(frequency, period);
  const edition = editionInEffect(state.editions, firstDayOfPeriod(period), state.zone);
  const unextended = nominalDueDate(edition.due_day, after);
  const extended = extensionDaysUsed !== null ? addDays(unextended, extensionDaysUsed) : unextended;
  const { dueDate, carriedFrom } = carryForward(extended, edition.carry, state.holidays);
  return {
    edition,
    unextended_nominal_date: unextended,
    due_date: dueDate,
    carried_from: carriedFrom,
    due_at: deadlineInstant(dueDate, state.zone),
  };
}

function addDays(date: string, days: number): string {
  const dt = DateTime.fromISO(date, { zone: 'utc' }).plus({ days });
  return dt.toISODate() ?? date;
}

function monthAfterPeriod(frequency: Frequency, period: string): { year: number; month: number } {
  const { year, month } = periodStart(period);
  if (frequency === 'yearly') return { year: year + 1, month: 1 };
  if (frequency === 'quarterly') {
    const quarter = Math.ceil(month / 3);
    return quarter === 4 ? { year: year + 1, month: 1 } : { year, month: quarter * 3 + 1 };
  }
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/** Practice "now": the frozen practice clock when set, real time otherwise. */
export function practiceNow(clockNow: Date | null): Date {
  return clockNow === null ? new Date() : clockNow;
}

/** Central's current date on the practice clock. */
export function centralDate(now: Date): string {
  return DateTime.fromJSDate(now, { zone: PRACTICE_ZONE }).toISODate() ?? '';
}
