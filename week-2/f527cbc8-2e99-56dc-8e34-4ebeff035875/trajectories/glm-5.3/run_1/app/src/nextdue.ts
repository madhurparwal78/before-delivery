import { connectDb, type Tx, type Row } from './db.js';
import { config } from './config.js';
import { now, todayInPractice } from './time.js';

/** One place decides the next-due status (DP-26). */
export function nextDueState(lastWorkedDate: string | null, cycleWeeks: number): { next_due_date: string | null; due_status: 'current' | 'due' | 'overdue' | 'unknown' } {
  if (!lastWorkedDate) return { next_due_date: null, due_status: 'unknown' };
  const [y, m, d] = lastWorkedDate.split('-').map(Number);
  const due = new Date(Date.UTC(y, m - 1, d + cycleWeeks * 7));
  const nextDue = `${due.getUTCFullYear()}-${String(due.getUTCMonth() + 1).padStart(2, '0')}-${String(due.getUTCDate()).padStart(2, '0')}`;
  const today = todayInPractice();
  const [ty, tm, td] = today.split('-').map(Number);
  const dueStart = new Date(Date.UTC(y, m - 1, d + cycleWeeks * 7 - 7));
  const dueStartStr = `${dueStart.getUTCFullYear()}-${String(dueStart.getUTCMonth() + 1).padStart(2, '0')}-${String(dueStart.getUTCDate()).padStart(2, '0')}`;
  const t = Date.UTC(ty, tm - 1, td);
  const nd = Date.UTC(y, m - 1, d + cycleWeeks * 7);
  const ds = Date.parse(dueStartStr + 'T00:00:00Z');
  const status = t < ds ? 'current' : (t <= nd ? 'due' : 'overdue');
  return { next_due_date: nextDue, due_status: status };
}

export function lastWorkedDate(horseVisits: Row[]): string | null {
  for (const v of horseVisits) {
    if (v.status !== 'open') return v.business_date;
  }
  return null;
}
