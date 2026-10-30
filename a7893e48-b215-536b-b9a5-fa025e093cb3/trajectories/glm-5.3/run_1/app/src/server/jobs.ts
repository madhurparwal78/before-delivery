import { q, withTx } from "./db.js";
import { checkBilling, billingOk } from "./killbill.js";
import { checkMail, flushQueue, queueEmail } from "./mailer.js";
import { audit, BookingRow } from "./domain.js";
import { cutoffFor } from "./policy.js";
import { getSite } from "./scope.js";
import { holdExpiredEmail, unpaidCancelEmail, expiryReminderEmail } from "./emails.js";
import { writeMovement, findPackForBooking } from "./pack.js";

/** Hold expiry: flip to expired within 15s and queue exactly one email. */
async function expireHolds(): Promise<void> {
  const r = await q(
    `SELECT h.* FROM holds h WHERE h.status = 'held' AND h.expires_at <= now() - interval '10 seconds'`,
  );
  for (const h of r.rows as { id: string; expires_at: Date }[]) {
    await withTx(async (tx) => {
      const cur = await tx.query(`SELECT status FROM holds WHERE id = $1 FOR UPDATE`, [h.id]);
      const status = (cur.rows[0] as { status: string } | undefined)?.status;
      if (status !== "held") return;
      await tx.query(`UPDATE holds SET status = 'expired' WHERE id = $1`, [h.id]);
    });
    // One email per hold that expires by time.
    const email = await withTx(async (tx) => {
      const cur = await tx.query(`SELECT expired_email_sent FROM holds WHERE id = $1 FOR UPDATE`, [h.id]);
      if ((cur.rows[0] as { expired_email_sent: boolean } | undefined)?.expired_email_sent) return null;
      await tx.query(`UPDATE holds SET expired_email_sent = true WHERE id = $1`, [h.id]);
      return true;
    });
    if (email) {
      const info = await q(
        `SELECT s.time_zone, st.name AS station_name, ho.date, r.email
         FROM holds h JOIN sites s ON s.id = h.site_id JOIN stations st ON st.id = h.station_id
         JOIN renters r ON r.id = h.renter_id
         JOIN hold_occurrences ho ON ho.hold_id = h.id
         WHERE h.id = $1 ORDER BY ho.ordinal LIMIT 1`,
        [h.id],
      );
      const row = info.rows[0] as { time_zone: string; station_name: string; date: Date; email: string } | undefined;
      if (row) {
        const msg = holdExpiredEmail(row.station_name, row.date.toISOString().slice(0, 10));
        await queueEmail(row.email, msg.subject, msg.body);
      }
    }
  }
}

/** Unpaid cutoffs: confirmed, unpaid bookings past their cutoff become unpaid_cancelled within 60s. */
async function runCutoffs(): Promise<void> {
  const r = await q(
    `SELECT b.* FROM bookings b WHERE b.status = 'confirmed' AND b.card_minutes > 0 AND b.cutoff_run = false`,
  );
  for (const b of r.rows as unknown as BookingRow[]) {
    const site = await getSite(b.site_id);
    if (!site) continue;
    const cutoff = cutoffFor(site.time_zone, b.start_at);
    if (Date.now() < cutoff.getTime()) continue;
    // Is it paid?
    const kb = await import("./killbill.js");
    let paid = false;
    try {
      paid = await kb.paymentHeld(`hs-booking-${b.id}`);
    } catch {
      paid = false; // billing unreachable: do not cancel on a maybe-paid booking
      if (!billingOk()) continue;
    }
    if (paid) {
      await q(`UPDATE bookings SET cutoff_run = true WHERE id = $1`, [b.id]);
      continue;
    }
    await withTx(async (tx) => {
      const cur = (await tx.query(`SELECT status FROM bookings WHERE id = $1 FOR UPDATE`, [b.id])).rows[0] as { status: string } | undefined;
      if (cur?.status !== "confirmed") return;
      const pm = await findPackForBooking(b.renter_id, b.id);
      if (pm) await writeMovement(tx, b.renter_id, "release", pm.minutes, b.id, pm.packId);
      await tx.query(`UPDATE bookings SET status = 'unpaid_cancelled', cutoff_run = true, time_refunded = false, deposit_refunded = false WHERE id = $1`, [b.id]);
      await audit(tx, b.id, null, "cutoff", "confirmed", "unpaid_cancelled");
    });
    const renter = (await q(`SELECT email FROM renters WHERE id = $1`, [b.renter_id])).rows[0] as { email: string } | undefined;
    const station = (await q(`SELECT name FROM stations WHERE id = $1`, [b.station_id])).rows[0] as { name: string };
    if (renter) {
      const { localDate, localStamp } = await import("../shared/time.js");
      const startLocal = localDate(site.time_zone, b.start_at.getTime());
      const cutoffStamp = localStamp(site.time_zone, cutoff.getTime());
      const msg = unpaidCancelEmail(station.name, startLocal, cutoffStamp);
      await queueEmail(renter.email, msg.subject, msg.body);
    }
  }
}

/** Document expiry reminders: exactly one, starting 14 local days before expiry. */
async function runReminders(): Promise<void> {
  const r = await q(`SELECT d.*, r.email, s.time_zone FROM documents d
    JOIN renters r ON r.id = d.renter_id
    JOIN sites s ON s.id = r.home_site_id
    WHERE d.reminder_sent = false`);
  for (const d of r.rows as { id: string; kind: "liability" | "food_handler"; expires_on: Date; email: string; time_zone: string }[]) {
    const today = new Date().toISOString().slice(0, 10);
    const expires = d.expires_on.toISOString().slice(0, 10);
    const minus14 = new Date(Date.parse(expires + "T00:00:00Z") - 14 * 86400000).toISOString().slice(0, 10);
    if (today < minus14 || today > expires) continue;
    // The local date in the renter's home-site zone.
    const { localDate } = await import("../shared/time.js");
    const localToday = localDate(d.time_zone, Date.now());
    if (localToday < minus14 || localToday > expires) continue;
    const taken = await withTx(async (tx) => {
      const cur = await tx.query(`SELECT reminder_sent FROM documents WHERE id = $1 FOR UPDATE`, [d.id]);
      if ((cur.rows[0] as { reminder_sent: boolean } | undefined)?.reminder_sent) return false;
      await tx.query(`UPDATE documents SET reminder_sent = true WHERE id = $1`, [d.id]);
      return true;
    });
    if (!taken) continue;
    const msg = expiryReminderEmail(d.kind, expires);
    await queueEmail(d.email, msg.subject, msg.body);
  }
}

export function startJobs(): void {
  let stopped = false;
  async function tick(): Promise<void> {
    try {
      await checkBilling();
      await checkMail();
      await flushQueue();
      await expireHolds();
      await runCutoffs();
      await runReminders();
      const { sweepKeys } = await import("./idempotency.js");
      await sweepKeys();
    } catch (e) {
      console.error("job tick failed", e);
    }
  }
  void tick();
  const timer = setInterval(() => {
    if (stopped) return;
    void tick();
  }, 5000);
  timer.unref();
}
