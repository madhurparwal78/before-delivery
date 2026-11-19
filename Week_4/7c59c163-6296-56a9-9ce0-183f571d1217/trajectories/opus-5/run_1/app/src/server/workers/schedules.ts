import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { memberById, venueById } from '../auth.js';
import { readBilling } from '../billing.js';
import { currentMonth, previousMonth, zonedDate } from '../domain/time.js';
import { generateStatements, clearFailedRun } from '../statements.js';
import type { Venue } from '../domain/types.js';

const STATEMENT_WINDOW_MINUTES = 10;
const STATEMENT_POLL_MS = 60_000;

/** Re-reads every builder's Kill Bill overdue state at least every OVERDUE_POLL_SECONDS seconds. */
async function pollOverdue(): Promise<void> {
  const builders = await pool.query<{ member_id: string; venue_id: string }>(
    `select m.id as member_id, m.venue_id from members m
      where 'builder' = any(m.roles) and m.venue_id is not null`,
  );
  for (const row of builders.rows) {
    const member = await memberById(pool, row.member_id);
    const venue = await venueById(pool, row.venue_id);
    if (member === null || venue === null) continue;
    await readBilling(member, venue).catch(() => undefined);
  }
}

/**
 * Statements are generated within 10 minutes after midnight on the 1st, venue time, for the month
 * that just ended. Missed runs are never caught up at start.
 */
async function runDueStatements(): Promise<void> {
  const venues = await pool.query<Venue>(
    'select id, slug, name, time_zone, taker_fee_bps, maker_fee_bps, flagship_symbol from venues',
  );
  for (const venue of venues.rows) {
    const today = zonedDate(venue.time_zone);
    if (today.day !== 1) continue;
    const minutes = minutesIntoDay(venue.time_zone);
    if (minutes >= STATEMENT_WINDOW_MINUTES) continue;
    const month = previousMonth(currentMonth(venue.time_zone));
    try {
      await generateStatements(venue, month);
    } catch {
      await clearFailedRun(venue.id, month);
    }
  }
}

function minutesIntoDay(timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
  const [hour, minute] = parts.split(':').map((value) => Number.parseInt(value, 10));
  return (hour as number) * 60 + (minute as number);
}

export function startSchedules(): () => void {
  const overdue = setInterval(() => void pollOverdue().catch(() => undefined), config.app.overduePollSeconds * 1000);
  const statements = setInterval(() => void runDueStatements().catch(() => undefined), STATEMENT_POLL_MS);
  overdue.unref();
  statements.unref();
  return () => {
    clearInterval(overdue);
    clearInterval(statements);
  };
}
