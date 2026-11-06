import type { Holiday } from '../../shared/types.js';
import { addDays, dateInZone, isoWeekday, localMidnight } from './zone.js';

export type CalendarVersion = {
  id: number;
  effectiveDate: string;
  timeZone: string;
  workingWeekdays: number[];
  holidays: Holiday[];
  cycleAnchor: string;
};

/** Every calendar save of a workspace, oldest first, starting with the seed calendar. */
export type CalendarHistory = {
  workspaceId: string;
  versions: CalendarVersion[];
};

export function currentCalendar(history: CalendarHistory): CalendarVersion {
  const latest = history.versions[history.versions.length - 1];
  if (latest === undefined) throw new Error(`Workspace ${history.workspaceId} has no calendar`);
  return latest;
}

/** The calendar in effect on a date: the latest save effective on or before it. */
export function calendarOn(history: CalendarHistory, date: string): CalendarVersion {
  let found = history.versions[0];
  for (const version of history.versions) {
    if (version.effectiveDate <= date) found = version;
  }
  if (found === undefined) throw new Error(`Workspace ${history.workspaceId} has no calendar`);
  return found;
}

export function historyKey(history: CalendarHistory): string {
  return `${history.workspaceId}:${history.versions.map((version) => version.id).join(',')}`;
}

export type DayCount = { counted: boolean; reason: string | null };

/** Whether a date is counted, and why it is not. Decided here for every surface. */
export function countedDay(history: CalendarHistory, date: string): DayCount {
  const calendar = calendarOn(history, date);
  const holiday = calendar.holidays.find((entry) => entry.date === date);
  if (holiday !== undefined) return { counted: false, reason: holiday.name };
  const weekday = isoWeekday(date);
  if (calendar.workingWeekdays.includes(weekday)) return { counted: true, reason: null };
  if (weekday === 6 || weekday === 7) return { counted: false, reason: 'Weekend' };
  return { counted: false, reason: 'Non-working day' };
}

/** A due date on an uncounted day is stored as the next counted day after it. */
export function snapToCountedDay(history: CalendarHistory, date: string): { date: string; snapped: boolean } {
  if (countedDay(history, date).counted) return { date, snapped: false };
  let cursor = date;
  for (let step = 0; step < 400; step += 1) {
    cursor = addDays(cursor, 1);
    if (countedDay(history, cursor).counted) return { date: cursor, snapped: true };
  }
  throw new Error('No counted day follows that date');
}

export function zoneOn(history: CalendarHistory, date: string): string {
  return calendarOn(history, date).timeZone;
}

/** 00:00 local time on a date, in the zone the calendar gives that day. */
export function midnightOn(history: CalendarHistory, date: string): number {
  return localMidnight(zoneOn(history, date), date);
}

export function todayOf(history: CalendarHistory, instant: number): string {
  return dateInZone(currentCalendar(history).timeZone, instant);
}

export function anchorOf(history: CalendarHistory): string {
  return currentCalendar(history).cycleAnchor;
}
