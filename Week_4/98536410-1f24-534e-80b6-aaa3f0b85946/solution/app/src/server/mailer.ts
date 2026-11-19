// Sends the queued confirmation messages. The outbox rows are written in the order's own
// transaction; any app copy may send, and a claim pushes the next attempt out so only one does.
import { config } from "./config.js";
import { one, pool } from "./db.js";
import { sendMail } from "./smtp.js";

const RETRY_AFTER_MS = 30_000;
const MAX_ATTEMPTS = 10;

interface OutboxRow {
  id: number;
  to_address: string;
  from_header: string;
  subject: string;
  body: string;
}

async function claim(): Promise<OutboxRow | null> {
  return one<OutboxRow>(pool,
    `UPDATE mail_outbox SET attempts = attempts + 1, next_attempt_at = $1
     WHERE id = (SELECT id FROM mail_outbox WHERE sent_at IS NULL AND attempts < $2 AND next_attempt_at <= $3
                 ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING id, to_address, from_header, subject, body`,
    [new Date(Date.now() + RETRY_AFTER_MS), MAX_ATTEMPTS, new Date()]);
}

let running = false;

export async function deliverPendingMail(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (let row = await claim(); row; row = await claim()) {
      try {
        await sendMail({ host: config.smtp.host, port: config.smtp.port, fromHeader: row.from_header, to: row.to_address, subject: row.subject, body: row.body });
        await pool.query("UPDATE mail_outbox SET sent_at = $2 WHERE id = $1", [row.id, new Date()]);
      } catch {
        // the claim already scheduled the retry in 30 seconds
      }
    }
  } finally {
    running = false;
  }
}

export function startMailer(): void {
  setInterval(() => void deliverPendingMail().catch(() => undefined), 1000).unref();
}
