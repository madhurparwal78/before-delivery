import type { DocumentKind } from '../../shared/types.js';
import { pool, query, queryOne, transaction } from '../db/pool.js';
import { writeAudit } from '../domain/audit.js';
import { expiryReminderEmail, holdExpiredEmail, unpaidCancellationEmail } from '../domain/emails.js';
import { writeMovement } from '../domain/pack.js';
import { BOOKING_SELECT, type BookingRow } from '../domain/records.js';
import { addDays, localDate } from '../domain/zone.js';
import { markBilling, markMail } from '../services/health.js';
import { billingReachable } from '../services/killbill.js';
import { drainEmailQueue, queueEmail } from '../services/mail.js';
import { mailReachable } from '../services/smtp.js';

const TICK_MS = 5_000;

interface ExpiringHoldRow {
  id: string;
  renter_email: string;
  station_name: string;
  site_name: string;
  time_zone: string;
  start_at: Date;
}

async function expireHolds(): Promise<void> {
  const rows = await query<ExpiringHoldRow>(
    pool,
    `SELECT h.id, r.email AS renter_email, st.name AS station_name, s.name AS site_name,
            s.time_zone, MIN(o.start_at) AS start_at
       FROM holds h
       JOIN renters r ON r.id = h.renter_id
       JOIN stations st ON st.id = h.station_id
       JOIN sites s ON s.id = h.site_id
       JOIN hold_occurrences o ON o.hold_id = h.id
      WHERE h.status = 'held' AND h.expires_at <= now()
      GROUP BY h.id, r.email, st.name, s.name, s.time_zone
      LIMIT 50`,
  );
  for (const row of rows) {
    await transaction(async (client) => {
      const claimed = await queryOne<{ id: string }>(
        client,
        `UPDATE holds SET status = 'expired', expiry_notified = true
           WHERE id = $1 AND status = 'held' AND expires_at <= now() AND expiry_notified = false
         RETURNING id`,
        [row.id],
      );
      if (claimed === null) return;
      await writeAudit(client, {
        holdId: row.id,
        actorName: 'system',
        actorRole: 'system',
        action: 'expire',
        from: 'held',
        to: 'expired',
      });
      await queueEmail(
        client,
        holdExpiredEmail({
          holdId: row.id,
          renterEmail: row.renter_email,
          stationName: row.station_name,
          siteName: row.site_name,
          timeZone: row.time_zone,
          startAt: row.start_at,
        }),
      );
    });
  }
}

async function cancelUnpaidBookings(): Promise<void> {
  const rows = await query<BookingRow>(
    pool,
    `${BOOKING_SELECT}
      WHERE b.status = 'confirmed' AND b.time_paid = false AND b.card_minutes > 0
        AND b.balance_due_by IS NOT NULL AND b.balance_due_by <= now()
      LIMIT 50`,
  );
  for (const row of rows) {
    await transaction(async (client) => {
      const claimed = await queryOne<{ id: string }>(
        client,
        `UPDATE bookings SET status = 'unpaid_cancelled'
           WHERE id = $1 AND status = 'confirmed' AND time_paid = false RETURNING id`,
        [row.id],
      );
      if (claimed === null) return;
      if (row.pack_minutes > 0) {
        await writeMovement(client, {
          renterId: row.renter_id,
          reason: 'release',
          minutes: row.pack_minutes,
          bookingId: row.id,
        });
      }
      await writeAudit(client, {
        bookingId: row.id,
        actorName: 'system',
        actorRole: 'system',
        action: 'cutoff',
        from: 'confirmed',
        to: 'unpaid_cancelled',
      });
      await queueEmail(client, unpaidCancellationEmail(row));
    });
  }
}

interface ReminderRow {
  id: string;
  kind: DocumentKind;
  expires_on: string;
  renter_email: string;
  time_zone: string;
}

async function queueExpiryReminders(): Promise<void> {
  const rows = await query<ReminderRow>(
    pool,
    `SELECT d.id, d.kind, d.expires_on, r.email AS renter_email, s.time_zone
       FROM documents d
       JOIN renters r ON r.id = d.renter_id
       JOIN sites s ON s.id = r.home_site_id
      WHERE d.reminder_queued_at IS NULL
      LIMIT 200`,
  );
  for (const row of rows) {
    const today = localDate(row.time_zone, new Date());
    if (today < addDays(row.expires_on, -14) || today > row.expires_on) continue;
    await transaction(async (client) => {
      const claimed = await queryOne<{ id: string }>(
        client,
        `UPDATE documents SET reminder_queued_at = now()
           WHERE id = $1 AND reminder_queued_at IS NULL RETURNING id`,
        [row.id],
      );
      if (claimed === null) return;
      await queueEmail(
        client,
        expiryReminderEmail({
          documentId: row.id,
          renterEmail: row.renter_email,
          kind: row.kind,
          expiresOn: row.expires_on,
        }),
      );
    });
  }
}

async function sweepStaleRecords(): Promise<void> {
  await pool.query("DELETE FROM idempotency_records WHERE created_at < now() - interval '24 hours'");
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
}

async function probeServices(): Promise<void> {
  markBilling(await billingReachable());
  markMail(await mailReachable());
}

async function tick(): Promise<void> {
  const steps = [
    probeServices,
    expireHolds,
    cancelUnpaidBookings,
    queueExpiryReminders,
    drainEmailQueue,
    sweepStaleRecords,
  ];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      process.stderr.write(`background step ${step.name} failed: ${String(error)}\n`);
    }
  }
}

export function startWorker(): void {
  const loop = (): void => {
    void tick().finally(() => {
      setTimeout(loop, TICK_MS);
    });
  };
  loop();
}
