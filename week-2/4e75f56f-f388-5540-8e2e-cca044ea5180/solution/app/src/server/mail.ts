// The outbound mail queue lives in Postgres; queuing is a write, sending is background work
// claimed row by row so no email is sent twice across processes.
import { tx, type Db } from "./db.js";
import { sendMail, type Mail } from "./smtp.js";

const BACKOFF_MS = 6_000;

/** After a failed send this process steps back, so a process that can reach Mailpit sends the queue. */
let backoffUntil = 0;

/** Queues an email once per dedupe key; queuing again with the same key changes nothing. */
export async function enqueueMail(db: Db, dedupeKey: string, mail: Mail): Promise<void> {
  await db.query(
    `INSERT INTO outbox (dedupe_key, to_address, subject, body) VALUES ($1, $2, $3, $4) ON CONFLICT (dedupe_key) DO NOTHING`,
    [dedupeKey, mail.to, mail.subject, mail.body],
  );
}

/** Sends due emails; a failed send is retried within seconds, without a restart. */
export async function drainOutbox(): Promise<void> {
  if (Date.now() < backoffUntil) return;
  for (;;) {
    const sent = await tx(async (db) => {
      const row = (
        await db.query<{ id: number; to_address: string; subject: string; body: string }>(
          `SELECT id, to_address, subject, body FROM outbox WHERE sent_at IS NULL AND retry_after <= now()
           ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        )
      ).rows[0];
      if (!row) return null;
      try {
        await sendMail({ to: row.to_address, subject: row.subject, body: row.body });
        await db.query("UPDATE outbox SET sent_at = now(), attempts = attempts + 1 WHERE id = $1", [row.id]);
        return true;
      } catch {
        backoffUntil = Date.now() + BACKOFF_MS;
        await db.query("UPDATE outbox SET attempts = attempts + 1, retry_after = now() + random() * interval '4 seconds' WHERE id = $1", [row.id]);
        return false;
      }
    });
    if (!sent) return;
  }
}

