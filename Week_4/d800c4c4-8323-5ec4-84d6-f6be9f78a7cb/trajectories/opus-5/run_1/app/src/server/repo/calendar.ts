import type { Pool, PoolClient } from 'pg';
import type { Settings } from '../../shared/types';
import { OpeningCalendar, type Closure, type OpeningHours } from '../domain/calendar';
import { WEEKDAYS, type LibraryDate, type Weekday } from '../../shared/time';

export type Db = Pool | PoolClient;

export async function readSettings(db: Db): Promise<Settings> {
  const rows = await db.query<Settings>(
    'select time_zone, late_fee_cents, damage_fee_cents, loan_period_days from settings where id = 1',
  );
  const settings = rows.rows[0];
  if (!settings) throw new Error('Settings row is missing');
  return settings;
}

export async function writeSettings(db: Db, settings: Settings): Promise<void> {
  await db.query(
    `update settings set time_zone = $1, late_fee_cents = $2, damage_fee_cents = $3,
     loan_period_days = $4 where id = 1`,
    [
      settings.time_zone,
      settings.late_fee_cents,
      settings.damage_fee_cents,
      settings.loan_period_days,
    ],
  );
}

export async function readCalendar(db: Db): Promise<OpeningCalendar> {
  const settings = await readSettings(db);
  const hours = await db.query<OpeningHours>(
    'select weekday, opens, closes from opening_hours order by weekday',
  );
  const closures = await db.query<Closure>(
    'select closure_date as date, reason from closures order by closure_date',
  );
  return new OpeningCalendar(settings.time_zone, hours.rows, closures.rows);
}

export function sortedHours(calendar: OpeningCalendar): OpeningHours[] {
  const entries: OpeningHours[] = [];
  for (const weekday of WEEKDAYS) {
    const hours = calendar.hoursFor(weekday);
    if (hours) entries.push(hours);
  }
  return entries;
}

export async function replaceHours(
  db: Db,
  hours: readonly { weekday: Weekday; opens: string; closes: string }[],
): Promise<void> {
  await db.query('delete from opening_hours');
  for (const entry of hours) {
    await db.query('insert into opening_hours (weekday, opens, closes) values ($1, $2, $3)', [
      entry.weekday,
      entry.opens,
      entry.closes,
    ]);
  }
}

export async function readClosures(db: Db): Promise<Closure[]> {
  const rows = await db.query<Closure>(
    'select closure_date as date, reason from closures order by closure_date',
  );
  return rows.rows;
}

export async function insertClosure(
  db: Db,
  date: LibraryDate,
  reason: string,
): Promise<boolean> {
  const rows = await db.query(
    `insert into closures (closure_date, reason) values ($1, $2)
     on conflict (closure_date) do nothing returning closure_date`,
    [date, reason],
  );
  return rows.rows.length > 0;
}

export async function deleteClosure(db: Db, date: LibraryDate): Promise<void> {
  await db.query('delete from closures where closure_date = $1', [date]);
}

/**
 * Moves every out loan whose due date is no longer an open day to the next open
 * day after it, and reports how many dates moved.
 */
export async function moveDueDatesOntoOpenDays(
  db: Db,
  calendar: OpeningCalendar,
): Promise<number> {
  const loans = await db.query<{ id: number; due_date: LibraryDate }>(
    "select id, due_date from loans where status = 'out' and due_date is not null for update",
  );
  let moved = 0;
  for (const loan of loans.rows) {
    if (calendar.isOpenDay(loan.due_date)) continue;
    await db.query('update loans set due_date = $1 where id = $2', [
      calendar.nextOpenDayAfter(loan.due_date),
      loan.id,
    ]);
    moved += 1;
  }
  return moved;
}
