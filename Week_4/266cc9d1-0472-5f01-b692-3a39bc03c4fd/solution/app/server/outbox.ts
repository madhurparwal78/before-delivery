// The email outbox shared by every app process through PostgreSQL. An email is recorded in the
// transaction that causes it, attempted by that request after commit, and otherwise delivered by
// whichever process can reach mail. A lease keeps any other process off an email while one tries.
import { firstRow, pool, type Db } from "./db.js";
import { sendEmail, type Email } from "./mail.js";
import { monitor } from "./monitor.js";

const LEASE_SECONDS = 30;
const WORKER_INTERVAL_MS = 5_000;

type EmailState = "queued" | "sent";

/** Records an email inside the caller's transaction, leased to the recording request. */
export async function recordEmail(db: Db, email: Email, reviewLinkId: string | null): Promise<number> {
  const found = await db.query<{ id: number }>(
    `INSERT INTO outbox (review_link_id, recipient, subject, body, lease_until)
     VALUES ($1, $2, $3, $4, clock_timestamp() + make_interval(secs => $5)) RETURNING id`,
    [reviewLinkId, email.to, email.subject, email.body, LEASE_SECONDS],
  );
  return firstRow(found).id;
}

async function attempt(id: number, email: Email): Promise<EmailState> {
  try {
    await sendEmail(email);
  } catch {
    await pool.query("UPDATE outbox SET lease_until = NULL WHERE id = $1 AND sent_at IS NULL", [id]);
    return "queued";
  }
  await pool.query("UPDATE outbox SET sent_at = clock_timestamp(), lease_until = NULL WHERE id = $1", [id]);
  return "sent";
}

/** The recording request's own attempt, after commit, within the 5-second limit. */
export async function deliverRecorded(id: number): Promise<EmailState> {
  const found = await pool.query<{ recipient: string; subject: string; body: string }>(
    "SELECT recipient, subject, body FROM outbox WHERE id = $1 AND sent_at IS NULL",
    [id],
  );
  const row = found.rows[0];
  if (row === undefined) return "sent";
  return attempt(id, { to: row.recipient, subject: row.subject, body: row.body });
}

/** Takes one queued email no other process holds, or null. */
async function leaseNext(): Promise<{ id: number; email: Email } | null> {
  const found = await pool.query<{ id: number; recipient: string; subject: string; body: string }>(
    `UPDATE outbox SET lease_until = clock_timestamp() + make_interval(secs => $1)
      WHERE id = (SELECT id FROM outbox WHERE sent_at IS NULL AND (lease_until IS NULL OR lease_until < clock_timestamp())
                  ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, recipient, subject, body`,
    [LEASE_SECONDS],
  );
  const row = found.rows[0];
  return row === undefined ? null : { id: row.id, email: { to: row.recipient, subject: row.subject, body: row.body } };
}

export function startOutboxWorker(): void {
  let running = false;
  setInterval(() => {
    if (running || !monitor.mailOk()) return;
    running = true;
    void (async () => {
      try {
        for (let next = await leaseNext(); next !== null; next = await leaseNext()) {
          if ((await attempt(next.id, next.email)) === "queued") break;
        }
      } catch (error) {
        console.error("outbox delivery:", error instanceof Error ? error.message : error);
      } finally {
        running = false;
      }
    })();
  }, WORKER_INTERVAL_MS).unref();
}

/** A link's email state: sent only once the mail server accepted its most recent email. */
export async function emailState(db: Db, reviewLinkId: string): Promise<EmailState> {
  const found = await db.query<{ sent: boolean }>(
    "SELECT sent_at IS NOT NULL AS sent FROM outbox WHERE review_link_id = $1 ORDER BY id DESC LIMIT 1",
    [reviewLinkId],
  );
  return found.rows[0]?.sent === true ? "sent" : "queued";
}
