import { DateTime } from 'luxon';
import { PRACTICE_ZONE } from './periods.js';

export interface EditionRule {
  effective_date: string;
  due_day: number;
  carry: 'next_business' | 'fixed';
  rate: string;
  extension_days: number;
}

/** The edition in effect at the state-local start of the period. */
export function editionInEffect(editions: EditionRule[], periodStart: string, zone: string): EditionRule {
  const startInstant = DateTime.fromISO(periodStart, { zone }).startOf('day');
  let chosen = editions[0];
  if (!chosen) throw new Error('state has no editions');
  for (const edition of editions) {
    const effective = DateTime.fromISO(edition.effective_date, { zone }).startOf('day');
    if (effective <= startInstant && effective > DateTime.fromISO(chosen.effective_date, { zone }).startOf('day')) {
      chosen = edition;
    }
  }
  return chosen;
}

/** The date before any carry-forward: edition due day in the month after the period, clamped. */
export function nominalDueDate(
  dueDay: number,
  monthAfter: { year: number; month: number },
): string {
  const lastDay = DateTime.fromObject({ year: monthAfter.year, month: monthAfter.month }).daysInMonth ?? 30;
  const day = Math.min(dueDay, lastDay);
  return `${monthAfter.year}-${String(monthAfter.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** One place that decides carry-forward. */
export function carryForward(
  nominal: string,
  carry: 'next_business' | 'fixed',
  holidays: string[],
): { dueDate: string; carriedFrom: string | null } {
  if (carry === 'fixed') return { dueDate: nominal, carriedFrom: null };
  const set = new Set(holidays);
  let date: string = nominal;
  let moved = false;
  for (let i = 0; i < 10; i++) {
    const dt = DateTime.fromISO(date, { zone: 'utc' });
    const weekday = dt.weekday; // 1 Mon .. 7 Sun
    const isWeekend = weekday === 6 || weekday === 7;
    if (!isWeekend && !set.has(date)) break;
    const next = dt.plus({ days: 1 }).toISODate();
    if (next === null) throw new Error('date arithmetic failed');
    date = next;
    moved = true;
  }
  return moved ? { dueDate: date, carriedFrom: nominal } : { dueDate: nominal, carriedFrom: null };
}

/** The deadline instant: 11:59:59.999 pm on the carried date in the state's zone. */
export function deadlineInstant(dueDate: string, zone: string): Date {
  const dt = DateTime.fromISO(dueDate, { zone })
    .plus({ hours: 23, minutes: 59, seconds: 59, milliseconds: 999 });
  return dt.toJSDate();
}

export function zoneLabel(zone: string): string {
  return (
    {
      'America/New_York': 'Eastern',
      'America/Chicago': 'Central',
      'America/Denver': 'Mountain',
      'America/Phoenix': 'Arizona',
      'America/Los_Angeles': 'Pacific',
      'Pacific/Honolulu': 'Hawaii',
    } as Record<string, string>
  )[zone] ?? zone;
}

/** Practice-zone deadline as `<h:mm am/pm> Central`. */
export function practiceDeadlineLabel(dueAt: Date): string {
  const dt = DateTime.fromJSDate(dueAt, { zone: PRACTICE_ZONE });
  const hour = dt.hour === 0 ? 12 : dt.hour > 12 ? dt.hour - 12 : dt.hour;
  const ampm = dt.hour < 12 ? 'am' : 'pm';
  return `${hour}:${String(dt.minute).padStart(2, '0')} ${ampm} Central`;
}

/** State offset minus Central offset, in hours, at the deadline. */
export function offsetHours(dueAt: Date, zone: string): number {
  const stateOffset = DateTime.fromJSDate(dueAt, { zone }).offset;
  const centralOffset = DateTime.fromJSDate(dueAt, { zone: PRACTICE_ZONE }).offset;
  return Math.round((stateOffset - centralOffset) / 60);
}

/** Whether the practice's current instant is after the deadline. The one overdue edge. */
export function isOverdue(status: string, dueAt: Date, now: Date): boolean {
  if (status !== 'not_started' && status !== 'prepared' && status !== 'client_approved') return false;
  return now.getTime() > dueAt.getTime();
}
