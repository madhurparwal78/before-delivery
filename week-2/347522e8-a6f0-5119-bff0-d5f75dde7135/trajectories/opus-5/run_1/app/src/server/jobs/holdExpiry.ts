/**
 * Hold expiry. A hold is live while the server's clock is strictly before its
 * `hold_expires_at`; at that instant its time is free, and within five seconds
 * the expiry is recorded, the hours return and one hold-expired email per
 * series is queued.
 *
 * The same sweep runs inline at the start of every booking transaction, so a
 * just-expired hold never blocks a new claim even between timer ticks.
 */

import { transaction, type Db } from '../db.js';
import { lockRenterHours, recordMovement } from '../domain/ledger.js';
import { holdExpiredMail, queueNotification } from '../services/notifications.js';

const SWEEP_INTERVAL_MS = 2_000;

interface DueHoldRow {
  id: string;
  series_id: string;
  renter_id: string;
  renter_email: string;
  station_name: string;
  date: string;
  start_hhmm: string;
  end_hhmm: string;
  minutes_debited: number;
}

/** Expires every hold whose instant has passed. Safe to call repeatedly. */
export async function expireDueHolds(tx: Db): Promise<void> {
  const due = await tx.query<DueHoldRow>(
    `SELECT b.id, b.series_id, b.renter_id, r.email AS renter_email, s.name AS station_name,
            b.date, b.start_hhmm, b.end_hhmm, b.minutes_debited
       FROM bookings b
       JOIN stations s ON s.id = b.station_id
       JOIN renters r ON r.id = b.renter_id
      WHERE b.status = 'hold' AND b.hold_expires_at <= now()
      ORDER BY b.renter_id, b.series_id, b.starts_at
      FOR UPDATE OF b`,
  );
  if (due.length === 0) return;

  for (const renterId of new Set(due.map((row) => row.renter_id))) {
    await lockRenterHours(tx, renterId);
  }

  for (const hold of due) {
    await tx.query("UPDATE bookings SET status = 'expired' WHERE id = $1", [hold.id]);
    await tx.query('DELETE FROM station_occupancy WHERE booking_id = $1', [hold.id]);
    await recordMovement(tx, {
      renterId: hold.renter_id,
      kind: 'hold_release',
      minutes: hold.minutes_debited,
      bookingId: hold.id,
      note: 'hold expired',
    });
  }

  // A series expires as a whole, so it gets one email.
  const seriesSeen = new Set<string>();
  for (const hold of due) {
    if (seriesSeen.has(hold.series_id)) continue;
    seriesSeen.add(hold.series_id);
    const weeks = due.filter((row) => row.series_id === hold.series_id);
    const minutes = weeks.reduce((sum, row) => sum + row.minutes_debited, 0);
    await queueNotification(
      tx,
      holdExpiredMail(
        hold.renter_email,
        hold.station_name,
        hold.date,
        hold.start_hhmm,
        hold.end_hhmm,
        minutes,
      ),
    );
  }
}

export function startHoldExpirySweep(): void {
  const tick = (): void => {
    void transaction(expireDueHolds).catch((error: unknown) => {
      process.stderr.write(`hold expiry sweep failed: ${String(error)}\n`);
    });
  };
  tick();
  setInterval(tick, SWEEP_INTERVAL_MS).unref();
}
