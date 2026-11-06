import { now } from "./clock";
import { transaction, withDb, type Db } from "./db";
import { sendMail, smtpReachable, type Mail } from "./smtp";
import { newId } from "./tokens";

/** Retries are paced by real time, so a frozen test clock never stalls a queued email. */
const RETRY_MS = 10_000;

interface QueuedMail extends Mail {
  /** The emailed link the message carries; its 15 minutes start when the message is handed to SMTP. */
  linkHash?: string;
  /** The request that queues it hands it to SMTP itself next; the retry sweep takes over only if that fails. */
  sendingNow?: boolean;
}

/** Queues a message in the caller's transaction, in the same step as the change that causes it; returns its id. */
export async function enqueue(db: Db, mail: QueuedMail): Promise<string> {
  const id = newId();
  await db.query(
    `INSERT INTO outbox (id, recipient, subject, body, link_hash, created_at, next_attempt_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, mail.to, mail.subject, mail.text, mail.linkHash ?? null, now(), new Date(Date.now() + (mail.sendingNow ? RETRY_MS : 0))],
  );
  return id;
}

/**
 * Claims one queued message in the caller's transaction and hands it to SMTP; it stays locked until that
 * transaction ends, so no other instance sends it meanwhile. Returns whether SMTP accepted it now: false
 * when SMTP refused (it stays queued for a retry) or another instance holds or already sent it.
 */
export async function deliverNow(db: Db, id: string): Promise<boolean> {
  const row = await db.query<{ recipient: string; subject: string; body: string; link_hash: string | null }>(
    "SELECT recipient, subject, body, link_hash FROM outbox WHERE id = $1 AND sent_at IS NULL FOR UPDATE SKIP LOCKED",
    [id],
  );
  const mail = row.rows[0];
  if (!mail) return false;
  try {
    await sendMail({ to: mail.recipient, subject: mail.subject, text: mail.body });
  } catch {
    await db.query("UPDATE outbox SET next_attempt_at = $2 WHERE id = $1", [id, new Date(Date.now() + RETRY_MS)]);
    return false;
  }
  const sentAt = now();
  await db.query("UPDATE outbox SET sent_at = $2 WHERE id = $1", [id, sentAt]);
  if (mail.link_hash) await db.query("UPDATE links SET sent_at = $2 WHERE token_hash = $1", [mail.link_hash, sentAt]);
  return true;
}

/**
 * Sends every queued message that is due, one per transaction: each is locked while it is sent (other
 * instances skip it) and marked sent in the same commit, so a message SMTP accepted is never sent again.
 * An instance whose own mail server is unreachable leaves the queue to instances that can deliver.
 */
export async function flushOutbox() {
  const waiting = await withDb((db) =>
    db.query("SELECT 1 FROM outbox WHERE sent_at IS NULL AND next_attempt_at <= $1 LIMIT 1", [new Date()]),
  );
  if (!waiting.rowCount || !(await smtpReachable())) return;
  for (;;) {
    const sent = await transaction(async (db) => {
      const due = await db.query<{ id: string }>(
        `SELECT id FROM outbox WHERE sent_at IS NULL AND next_attempt_at <= $1
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [new Date()],
      );
      return due.rows[0] ? deliverNow(db, due.rows[0].id) : null;
    });
    if (!sent) return;
  }
}
