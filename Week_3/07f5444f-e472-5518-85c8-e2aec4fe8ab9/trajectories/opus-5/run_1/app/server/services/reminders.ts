import { businessDateOf, displayBusinessDate } from '../../shared/london.js';
import { loadRentalAggregates } from '../data/rentals.js';
import type { Queryable } from '../db/pool.js';
import { withTransaction } from '../db/pool.js';
import { dueDateOf, reminderIsDue } from '../domain/rental-dates.js';
import { sendMessage } from './mail.js';
import { retryQueuedNotices } from './notices.js';
import { config } from '../config.js';

interface DueReminder {
  rental_set_id: string;
  person_id: string;
  email: string;
}

async function createDueReminderRows(db: Queryable, todayBusinessDate: string): Promise<void> {
  const aggregates = await loadRentalAggregates(db, null);
  const due = aggregates.filter((aggregate) =>
    reminderIsDue(aggregate.row.status, dueDateOf(aggregate.finalPerformanceDate), todayBusinessDate),
  );
  for (const aggregate of due) {
    await db.query(
      `INSERT INTO rental_reminders (rental_set_id, person_id, status)
       SELECT $1, id, 'queued' FROM people WHERE role = 'assistant_librarian'
       ON CONFLICT (rental_set_id, person_id) DO NOTHING`,
      [aggregate.row.id],
    );
  }
}

async function sendClaimedReminders(db: Queryable): Promise<void> {
  const claimed = await db.query<DueReminder>(
    `SELECT r.rental_set_id, r.person_id, p.email
       FROM rental_reminders r
       JOIN people p ON p.id = r.person_id
      WHERE r.status = 'queued'
      ORDER BY r.created_at
        FOR UPDATE OF r SKIP LOCKED`,
  );
  if (claimed.rows.length === 0) return;
  const aggregates = await loadRentalAggregates(db, [...new Set(claimed.rows.map((row) => row.rental_set_id))]);
  const byId = new Map(aggregates.map((aggregate) => [aggregate.row.id, aggregate]));

  for (const reminder of claimed.rows) {
    const aggregate = byId.get(reminder.rental_set_id);
    if (!aggregate) continue;
    const dueDate = dueDateOf(aggregate.finalPerformanceDate);
    const onSlip = aggregate.slip.reduce((total, line) => total + line.copies, 0);
    const checkedIn = aggregate.slip.reduce((total, line) => total + line.checked_in, 0);
    const programmeNumber = String(aggregate.row.programme_number).padStart(2, '0');
    const dueLabel = displayBusinessDate(dueDate);
    try {
      await sendMessage({
        to: reminder.email,
        subject: `Rental return due ${dueLabel}: ${aggregate.row.work_title} \u00b7 ${aggregate.row.publisher}`,
        body: [
          `Publisher: ${aggregate.row.publisher}`,
          `Programme ${programmeNumber} \u00b7 ${aggregate.row.programme_title}`,
          `Copies on slip: ${onSlip}`,
          `Copies checked in: ${checkedIn}`,
          `Due: ${dueLabel} at 23:59 (London time)`,
        ].join('\n'),
      });
    } catch {
      return;
    }
    await db.query(
      `UPDATE rental_reminders SET status = 'sent', sent_at = now()
        WHERE rental_set_id = $1 AND person_id = $2 AND status = 'queued'`,
      [reminder.rental_set_id, reminder.person_id],
    );
  }
}

/**
 * Creates every due reminder row, then sends the queued reminders and retries queued
 * folder notices. Each row is claimed with a row lock, so one email goes to each
 * assistant librarian per rental set however many processes sweep.
 */
export async function sweepReminders(): Promise<void> {
  const todayBusinessDate = businessDateOf(Date.now());
  await withTransaction(async (db) => {
    await createDueReminderRows(db, todayBusinessDate);
  });
  await withTransaction(async (db) => {
    await sendClaimedReminders(db);
    await retryQueuedNotices(db);
  });
}

export function startReminderSweeps(): void {
  const run = (): void => {
    sweepReminders().catch(() => undefined);
  };
  run();
  const timer = setInterval(run, config.reminderSweepSeconds * 1000);
  timer.unref();
}
