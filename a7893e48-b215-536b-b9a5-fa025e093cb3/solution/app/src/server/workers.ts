import { audit } from "./audit.js";
import { all, pool, tx } from "./db.js";
import type { DocumentRow } from "./documents.js";
import { expiryReminderEmail, holdExpiredEmail, unpaidCancellationEmail } from "./emails.js";
import { billingReachable } from "./killbill.js";
import { lockRenter, move } from "./ledger.js";
import { deliver, mailReachable, queueEmail } from "./mail.js";
import { bookingTransition, holdTransition } from "./rules.js";
import type { BookingRow, HoldRow } from "./scope.js";
import { serviceStatus } from "./status.js";
import { addDays, localDate } from "./time.js";
import { isPaid } from "./views.js";

/** Hold expiry on the server clock: status reads expired and one hold-expired email is queued. */
async function expireHolds(): Promise<void> {
  await tx(async (client) => {
    const now = new Date();
    const due = await all<HoldRow & { station: string; site: string; email: string; local_date: string }>(client,
      `SELECT h.*, st.name AS station, s.name AS site, r.email, o.local_date FROM holds h
         JOIN stations st ON st.id = h.station_id JOIN sites s ON s.id = h.site_id JOIN renters r ON r.id = h.renter_id
         JOIN hold_occurrences o ON o.hold_id = h.id AND o.position = 0
        WHERE h.status = 'held' AND h.expires_at <= $1 ORDER BY h.expires_at LIMIT 50 FOR NO KEY UPDATE OF h SKIP LOCKED`, [now]);
    for (const hold of due) {
      const to = holdTransition("expire", hold.status, hold.expires_at, now);
      await client.query("UPDATE holds SET status = $2, ended_at = $3 WHERE id = $1", [hold.id, to, now]);
      await audit(client, { holdId: hold.id, actor: "system", action: "expire", from: hold.status, to, at: now });
      const email = holdExpiredEmail(hold.station, hold.local_date, hold.site);
      await queueEmail(client, hold.email, email.subject, email.body);
    }
  });
}

/** Unpaid cutoff: a confirmed booking still unpaid at its cutoff is cancelled, its pack minutes released, deposit kept. */
async function cancelUnpaid(): Promise<void> {
  await tx(async (client) => {
    const now = new Date();
    const due = await all<BookingRow & { station: string; email: string; time_zone: string; notice_hours: number }>(client,
      `SELECT b.*, st.name AS station, r.email, s.time_zone, pv.notice_hours FROM bookings b
         JOIN stations st ON st.id = b.station_id JOIN renters r ON r.id = b.renter_id JOIN sites s ON s.id = b.site_id
         JOIN policy_versions pv ON pv.id = b.policy_version_id
        WHERE b.status = 'confirmed' AND b.card_minutes > 0 AND b.time_payment_id IS NULL AND b.cutoff_at <= $1
        ORDER BY b.cutoff_at LIMIT 50 FOR NO KEY UPDATE OF b SKIP LOCKED`, [now]);
    for (const booking of due) {
      const to = bookingTransition("cutoff", { status: booking.status, startAt: booking.start_at, noticeHours: booking.notice_hours, paid: isPaid(booking) }, now);
      await lockRenter(client, booking.renter_id);
      if (booking.pack_minutes > 0) await move(client, { renterId: booking.renter_id, reason: "release", minutes: booking.pack_minutes, at: now, bookingId: booking.id });
      await client.query("UPDATE bookings SET status = $2, cancelled_at = $3, pack_returned_minutes = $4 WHERE id = $1", [booking.id, to, now, booking.pack_minutes]);
      await audit(client, { bookingId: booking.id, actor: "system", action: "cutoff", from: booking.status, to, at: now });
      const email = unpaidCancellationEmail(booking.station, localDate(booking.time_zone, booking.start_at), booking.time_zone, booking.cutoff_at ?? now);
      await queueEmail(client, booking.email, email.subject, email.body);
    }
  });
}

/** One reminder per document, from 14 local days before it expires (in the renter's home-site zone) to its expiry date. */
async function checkReminders(): Promise<void> {
  await tx(async (client) => {
    const now = new Date();
    const window = addDays(now.toISOString().slice(0, 10), -1);
    const candidates = await all<DocumentRow & { email: string; time_zone: string }>(client,
      `SELECT d.*, r.email, s.time_zone FROM documents d JOIN renters r ON r.id = d.renter_id JOIN sites s ON s.id = r.home_site_id
        WHERE d.reminder_queued_at IS NULL AND d.expires_on >= $1 FOR UPDATE OF d SKIP LOCKED`, [window]);
    for (const doc of candidates) {
      const today = localDate(doc.time_zone, now);
      if (today < addDays(doc.expires_on, -14) || today > doc.expires_on) continue;
      await client.query("UPDATE documents SET reminder_queued_at = $2 WHERE id = $1", [doc.id, now]);
      const email = expiryReminderEmail(doc.kind, doc.expires_on);
      await queueEmail(client, doc.email, email.subject, email.body);
    }
  });
}

/** Delivers queued emails exactly once while mail is reachable; an unreachable server leaves them queued. */
async function deliverOutbox(): Promise<void> {
  if (serviceStatus.mail !== "ok") return;
  const batch = await all<{ id: number; to_address: string; subject: string; body: string }>(pool,
    `UPDATE emails SET claimed_until = now() + interval '2 minutes'
      WHERE id IN (SELECT id FROM emails WHERE sent_at IS NULL AND (claimed_until IS NULL OR claimed_until < now())
                    ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED)
      RETURNING id, to_address, subject, body`);
  for (const [index, email] of batch.entries()) {
    try {
      await deliver(email.to_address, email.subject, email.body);
      await pool.query("UPDATE emails SET sent_at = now(), claimed_until = NULL WHERE id = $1", [email.id]);
    } catch {
      serviceStatus.mail = "delayed";
      await pool.query("UPDATE emails SET claimed_until = NULL WHERE id = ANY($1::bigint[])", [batch.slice(index).map((item) => item.id)]);
      return;
    }
  }
}

async function probe(): Promise<void> {
  const [billing, mail] = await Promise.all([billingReachable(), mailReachable()]);
  serviceStatus.billing = billing ? "ok" : "delayed";
  serviceStatus.mail = mail ? "ok" : "delayed";
}

/** Runs a task now and again `ms` after each run finishes; failures are logged without detail that could hold secrets. */
function every(ms: number, name: string, task: () => Promise<void>): void {
  const run = (): void => {
    task().catch((error: unknown) => console.error(`${name} failed: ${error instanceof Error ? error.message : "unknown error"}`))
      .finally(() => setTimeout(run, ms).unref());
  };
  run();
}

/** Background work runs inside the serving process; its state lives in Postgres, so it survives a restart. */
export function startWorkers(): void {
  every(5000, "service probe", probe);
  every(2000, "hold expiry", expireHolds);
  every(5000, "unpaid cutoff", cancelUnpaid);
  every(5000, "expiry reminders", checkReminders);
  every(2000, "outbox", deliverOutbox);
}
