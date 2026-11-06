import { query, withTransaction } from "../db.js";
import { formatDay } from "../../shared/format.js";

import { reladder, liveStates, type OptionRow } from "./ladder.js";
import { queueEmail } from "./outbox.js";
import { sendReminderIfDue, type LicenceRow } from "./licences.js";
import { deliverPendingMail } from "./outbox.js";
import { cleanupIdempotency } from "./idempotency.js";

/** The sweep: expires holds, resolves challenge deadlines and sends licence reminders, exactly once each. */

export async function runSweep(): Promise<void> {
  await expireHolds();
  await resolveChallenges();
  await licenceReminders();
}

/** Expires options whose releaseAt has passed, promoting the options below. */
async function expireHolds(): Promise<void> {
  const rows = await query<OptionRow & { talent_office: string; company: string; display_name: string }>(
    `SELECT o.*, t.office AS talent_office, c.company, t.display_name
     FROM options o JOIN talent t ON t.id = o.talent_id JOIN clients c ON c.id = o.client_id
     WHERE o.state IN ('placed','challenged') AND o.release_at <= now()
     ORDER BY o.release_at LIMIT 50`
  );
  for (const row of rows) {
    await withTransaction(async (tx) => {
      const fresh = await tx.one<OptionRow>(`SELECT * FROM options WHERE id = $1 FOR UPDATE`, [row.id]);
      if (!fresh || !liveStates().includes(fresh.state) || fresh.release_at.getTime() > Date.now()) return;
      const dayText = typeof fresh.date === "string" ? fresh.date.slice(0, 10) : fresh.date.toISOString().slice(0, 10);
      const reason = fresh.hold_until && fresh.hold_until <= fresh.release_at && fresh.hold_until.getTime() === fresh.release_at.getTime() ? "hold_expired" : "auto_release";
      await tx.query(`UPDATE options SET state = 'expired', released_at = now(), release_reason = $2, rank = NULL, version = version + 1 WHERE id = $1`, [fresh.id, reason]);
      await reladder(tx, fresh.talent_id, fresh.date);
      const emails = await tx.one<{ contact_email: string }>(`SELECT contact_email FROM clients WHERE id = $1`, [fresh.client_id]);
      if (emails) {
        await queueEmail({
          to: emails.contact_email,
          subject: `Option update: ${row.display_name} on ${formatDay(dayText)}`,
          body: [`Hello,`, ``, `Your 1st option was released.`, ``, `Talent: ${row.display_name}`, `Day: ${formatDay(dayText)}`, ``, `Vesper & Rowe Talent`].join("\r\n"),
        });
      }
    }).catch(() => {});
  }
}

/** Releases challenged 1st options past their deadline, promoting the 2nd and emailing both clients. */
async function resolveChallenges(): Promise<void> {
  const rows = await query<OptionRow & { talent_office: string; company: string; display_name: string }>(
    `SELECT o.*, t.office AS talent_office, c.company, t.display_name
     FROM options o JOIN talent t ON t.id = o.talent_id JOIN clients c ON c.id = o.client_id
     WHERE o.state = 'challenged' AND o.challenge_deadline <= now()
     ORDER BY o.challenge_deadline LIMIT 50`
  );
  for (const row of rows) {
    await withTransaction(async (tx) => {
      const fresh = await tx.one<OptionRow>(`SELECT * FROM options WHERE id = $1 FOR UPDATE`, [row.id]);
      if (!fresh || fresh.state !== "challenged" || !fresh.challenge_deadline || fresh.challenge_deadline.getTime() > Date.now()) return;
      await tx.query(`UPDATE options SET state = 'released', released_at = now(), release_reason = 'challenge_timeout', rank = NULL, version = version + 1, challenge_deadline = NULL WHERE id = $1`, [fresh.id]);
      await reladder(tx, fresh.talent_id, fresh.date);
      // the promoted 2nd (now 1st) and the released 1st: both clients get one email
      const clients = await tx.query<{ id: string; company: string; contact_email: string }>(
        `SELECT DISTINCT c.id, c.company, c.contact_email FROM clients c WHERE c.id IN (
           SELECT client_id FROM options WHERE talent_id = $1 AND date = $2::date AND state IN ('placed','challenged')
         ) OR c.id = $3`,
        [fresh.talent_id, fresh.date, fresh.client_id]
      );
      const day = formatDay(typeof fresh.date === "string" ? fresh.date.slice(0, 10) : fresh.date.toISOString().slice(0, 10));
      const subject = `Option update: ${row.display_name} on ${day}`;
      for (const client of clients) {
        const isReleasedClient = client.id === fresh.client_id;
        const line = isReleasedClient ? "Your 1st option was released." : "Your option is now 1st.";
        await queueEmail({
          to: client.contact_email,
          subject,
          body: [`Hello,`, ``, line, ``, `Talent: ${row.display_name}`, `Day: ${day}`, ``, `Vesper & Rowe Talent`].join("\r\n"),
        });
      }
    }).catch(() => {});
  }
}

async function licenceReminders(): Promise<void> {
  const rows = await query<LicenceRow>(
    `SELECT *, to_char(first_use_date,'YYYY-MM-DD') AS first_use_date, to_char(ends_on,'YYYY-MM-DD') AS ends_on FROM licences
     WHERE reminder_sent_date IS DISTINCT FROM ends_on
     ORDER BY ends_on LIMIT 100`
  );
  for (const licence of rows) {
    await withTransaction(async (tx) => {
      const fresh = await tx.one<LicenceRow>(`SELECT *, to_char(first_use_date,'YYYY-MM-DD') AS first_use_date, to_char(ends_on,'YYYY-MM-DD') AS ends_on FROM licences WHERE id = $1 FOR UPDATE`, [licence.id]);
      if (!fresh) return;
      await sendReminderIfDue(tx, fresh, new Date());
    }).catch(() => {});
  }
}

export async function deliverMail(): Promise<void> {
  await deliverPendingMail().catch(() => {});
}

export async function cleanupJobs(): Promise<void> {
  await cleanupIdempotency().catch(() => {});
  await query(`DELETE FROM rate_limits WHERE window_start < now() - interval '10 minutes'`).catch(() => {});
  await query(`DELETE FROM sessions WHERE expires_at < now() - interval '1 day' AND ended_at IS NOT NULL`).catch(() => {});
}
