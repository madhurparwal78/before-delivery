import { ReturnStatus } from '../../shared/types';
import { newId } from '../auth';
import { query, transaction, Tx } from '../db';
import { PRIORITY, publish } from '../events';
import { reminderSchedule } from '../domain/reminders';
import { isUnfiled } from '../domain/rules';
import { packetHtml } from '../packet/html';
import { getPractice, practiceNow } from '../repo/practice';
import { loadReturnRowById, presentReturns } from '../repo/returns';
import { deliver } from '../services/mail';
import { reminderMessage } from '../services/notices';
import { renderPdf } from '../services/pdf';
import { serialise } from './mutex';

/**
 * An unfiled return always carries a 7-day and a 1-day reminder from its
 * current due date. Filing removes the unsent ones; sent records stay.
 */
export async function syncReminders(
  tx: Tx,
  returnId: string,
  status: ReturnStatus,
  dueDate: string,
  reminderHour: number,
): Promise<void> {
  if (!isUnfiled(status)) {
    await tx.query('DELETE FROM reminders WHERE return_id = $1 AND sent_at_ms IS NULL', [returnId]);
    return;
  }
  for (const reminder of reminderSchedule(dueDate, reminderHour)) {
    await tx.query(
      `INSERT INTO reminders (id, return_id, lead_days, scheduled_for_ms) VALUES ($1,$2,$3,$4)
       ON CONFLICT (return_id, lead_days)
       DO UPDATE SET scheduled_for_ms = EXCLUDED.scheduled_for_ms
       WHERE reminders.sent_at_ms IS NULL`,
      [newId(), returnId, reminder.leadDays, reminder.scheduledForMs],
    );
  }
}

async function bookkeeperEmail(practiceId: string): Promise<string | null> {
  const rows = await query<{ email: string }>(
    `SELECT email FROM users WHERE practice_id = $1 AND role = 'bookkeeper' ORDER BY created_ms LIMIT 1`,
    [practiceId],
  );
  return rows.length > 0 ? rows[0].email : null;
}

interface DueReminderRow {
  id: string;
  return_id: string;
  lead_days: number;
}

/**
 * Attempts every pending reminder whose scheduled instant has arrived on the
 * practice clock. A reminder becomes sent only once Mailpit accepted it.
 */
export async function attemptDueReminders(practiceId: string): Promise<void> {
  await serialise(`reminders:${practiceId}`, async () => {
    const practice = await getPractice(practiceId);
    if (!practice) return;
    const now = practiceNow(practice);
    const due = await query<DueReminderRow>(
      `SELECT rem.id, rem.return_id, rem.lead_days
         FROM reminders rem JOIN returns r ON r.id = rem.return_id
        WHERE r.practice_id = $1 AND rem.sent_at_ms IS NULL AND rem.scheduled_for_ms <= $2
        ORDER BY rem.scheduled_for_ms, rem.lead_days DESC`,
      [practiceId, now],
    );
    if (due.length === 0) return;
    const recipient = await bookkeeperEmail(practiceId);
    if (!recipient) return;
    const lines = [];
    for (const reminder of due) {
      const row = await loadReturnRowById(reminder.return_id);
      if (!row || !isUnfiled(row.status)) continue;
      const [record] = await presentReturns([row], now);
      const message = reminderMessage(record, reminder.lead_days === 7 ? 7 : 1);
      if (!(await deliver({ to: recipient, ...message }))) continue;
      const current = await getPractice(practiceId);
      const acceptedAt = current ? practiceNow(current) : now;
      const marked = await query<{ id: string }>(
        'UPDATE reminders SET sent_at_ms = $2 WHERE id = $1 AND sent_at_ms IS NULL RETURNING id',
        [reminder.id, acceptedAt],
      );
      if (marked.length === 0) continue;
      lines.push({
        text: `Reminder sent for ${record.client.name} ${record.state} ${record.period_label}.`,
        priority: PRIORITY.reminder_sent,
        roles: ['bookkeeper' as const],
        clientId: null,
      });
    }
    if (lines.length > 0) publish(practiceId, { lines });
  });
}

interface MailJobRow {
  id: string;
  recipient: string;
  subject: string;
  body: string;
}

/** Notices wait through a mail outage exactly as reminders do. */
export async function attemptMailJobs(practiceId: string): Promise<void> {
  await serialise(`notices:${practiceId}`, async () => {
    const jobs = await query<MailJobRow>(
      `SELECT id, recipient, subject, body FROM mail_jobs
        WHERE practice_id = $1 AND sent_ms IS NULL ORDER BY seq`,
      [practiceId],
    );
    for (const job of jobs) {
      if (!(await deliver({ to: job.recipient, subject: job.subject, body: job.body }))) return;
      await query('UPDATE mail_jobs SET sent_ms = $2 WHERE id = $1 AND sent_ms IS NULL', [
        job.id,
        Date.now(),
      ]);
    }
  });
}

/**
 * Renders every outstanding packet. A return becomes packeted only when
 * Gotenberg returned the PDF bytes; a held or failed render leaves it pending.
 */
export async function attemptRenders(practiceId: string): Promise<void> {
  await serialise(`renders:${practiceId}`, async () => {
    const practice = await getPractice(practiceId);
    if (!practice) return;
    const now = practiceNow(practice);
    const outstanding = await query<{ id: string; packet_target_revision: number }>(
      `SELECT id, packet_target_revision FROM returns
        WHERE practice_id = $1 AND status IN ('filed','amended')
          AND packet_target_revision > packet_revisions
        ORDER BY created_ms`,
      [practiceId],
    );
    for (const outstandingReturn of outstanding) {
      const row = await loadReturnRowById(outstandingReturn.id);
      if (!row) continue;
      const [record] = await presentReturns([row], now);
      const target = outstandingReturn.packet_target_revision;
      const bytes = await renderPdf(packetHtml(record, target));
      if (!bytes) continue;
      const ready = await transaction(async (tx) => {
        const current = await tx.queryOne<{
          packet_target_revision: number;
          packet_revisions: number;
          status: ReturnStatus;
        }>(
          `SELECT packet_target_revision, packet_revisions, status FROM returns
            WHERE id = $1 FOR UPDATE`,
          [outstandingReturn.id],
        );
        if (!current || current.packet_revisions >= target) return false;
        await tx.query(
          `INSERT INTO packet_revisions (return_id, revision, bytes, created_ms)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [outstandingReturn.id, target, bytes, Date.now()],
        );
        const becomesPacketed = current.packet_target_revision === target;
        await tx.query(
          `UPDATE returns SET packet_revisions = $2, version = version + 1,
                  status = CASE WHEN $3 THEN 'packeted' ELSE status END
             WHERE id = $1`,
          [outstandingReturn.id, target, becomesPacketed],
        );
        return becomesPacketed;
      });
      if (ready) {
        publish(practiceId, {
          lines: [
            {
              text: `Packet ready for ${record.client.name} ${record.state} ${record.period_label}.`,
              priority: PRIORITY.packet_ready,
              roles: ['bookkeeper', 'owner'],
              clientId: record.client.id,
            },
          ],
        });
      }
    }
  });
}

/** Everything that waits on a service, attempted for one practice. */
export function pumpPractice(practiceId: string): void {
  void attemptDueReminders(practiceId);
  void attemptMailJobs(practiceId);
  void attemptRenders(practiceId);
}

export async function pumpAllPractices(): Promise<void> {
  const practices = await query<{ id: string }>('SELECT id FROM practices');
  for (const practice of practices) {
    await attemptDueReminders(practice.id);
    await attemptMailJobs(practice.id);
    await attemptRenders(practice.id);
  }
}
