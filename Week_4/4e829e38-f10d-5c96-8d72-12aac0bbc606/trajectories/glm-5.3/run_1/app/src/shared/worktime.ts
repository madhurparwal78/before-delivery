import { daysBetween, addDays, ymdToUTC, dateUTC } from './dates';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const WORKDAYS = [1, 2, 3, 4, 5];

export function isWorkingDay(ymd: string): boolean {
  const d = ymdToUTC(ymd);
  if (!d) return false;
  const wd = d.getUTCDay();
  return wd >= 1 && wd <= 5;
}

export function workingDays(from: string, to: string): string[] {
  const out: string[] = [];
  if (!ymdToUTC(from) || !ymdToUTC(to) || to < from) return out;
  let cur = from;
  for (let i = 0; i < 400 && cur <= to; i++) {
    if (isWorkingDay(cur)) out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export interface EffortShare { date: string; hours: number; }

/** Spreads a task's effort over its working days, Monday to Friday only. */
export function spreadEffort(start: string | null, due: string | null, effort: number | null, completed: boolean, assigneeId: string | null): EffortShare[] {
  if (completed || !assigneeId || effort === null || effort <= 0 || !due) return [];
  if (!start) return isWorkingDay(due) ? [{ date: due, hours: effort }] : [];
  if (due < start) return [];
  const days = workingDays(start, due);
  if (days.length === 0) return [];
  const per = effort / days.length;
  return days.map(d => ({ date: d, hours: per }));
}

export function nextRecurrenceDue(recurrence: string, prevDue: string, today: string): string | null {
  const weekly = /^Every week on (\w+)$/.exec(recurrence);
  if (weekly) {
    const target = WEEKDAYS.indexOf(weekly[1].toLowerCase());
    if (target === -1) return null;
    const d = ymdToUTC(prevDue);
    if (!d) return null;
    for (let i = 1; i <= 7; i++) {
      const nd = new Date(d.getTime() + i * 86400000);
      if (nd.getUTCDay() === target) return dateUTC(nd);
    }
    return null;
  }
  const monthly = /^Every month on day (\d+)$/.exec(recurrence);
  if (monthly) {
    const n = Number(monthly[1]);
    const d = ymdToUTC(prevDue);
    if (!d) return null;
    let y = d.getUTCFullYear(), m = d.getUTCMonth() + 2;
    if (m > 12) { m = 1; y++; }
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const day = Math.min(n, lastDay);
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const after = /^Every (\d+) days after completion$/.exec(recurrence);
  if (after) return addDays(today, Number(after[1]));
  return null;
}

export function recurrenceRecursByClock(recurrence: string): boolean {
  return recurrence.startsWith('Every week on ') || recurrence.startsWith('Every month on ');
}

export function shiftByDays(start: string | null, prevDue: string, nextDue: string): string | null {
  if (!start) return null;
  return addDays(start, daysBetween(prevDue, nextDue));
}

export function roundHalfUp1(x: number): number {
  const scaled = x * 10;
  const r = scaled < 0 ? -Math.floor(-scaled + 0.5) : Math.floor(scaled + 0.5);
  return r / 10;
}

export function fmtCellTotal(x: number): string {
  const r = roundHalfUp1(x);
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function capacityFor(weekday: string, capacities: Record<string, number>): number {
  return capacities[weekday] ?? 8;
}
