// The outbox: every e-mail is recorded first, then sent exactly once by whichever running copy claims it.
import { notify, pool, transaction, type Tx } from "./db.js";
import { sendMail, type MailMessage } from "./smtp.js";

type MailKind = "receipt" | "offer" | "exchange" | "refund";

/** Records an e-mail for delivery; a receipt names its order, whose receipt status is this row's status. */
export async function enqueueMail(tx: Tx, kind: MailKind, message: MailMessage, orderId: string | null = null): Promise<void> {
  await tx.query("INSERT INTO outbox (recipient, subject, body, kind, order_id) VALUES ($1, $2, $3, $4, $5)",
    [message.to, message.subject, message.body, kind, orderId]);
  await notify(tx, { k: "outbox" });
}

interface Claimed {
  id: string;
  recipient: string;
  subject: string;
  body: string;
}

/** Longer than one SMTP attempt (10 s), short enough that another copy retries soon after a copy stops mid-send. */
const CLAIM_SECONDS = 12;
let running = false;

/** Sends queued messages one at a time until none is left or the mail server cannot be reached. */
export async function deliverQueued(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const claimed = await pool.query<Claimed>(
        `UPDATE outbox SET claimed_until = now() + make_interval(secs => $1), attempts = attempts + 1
         WHERE id = (SELECT id FROM outbox WHERE status = 'queued' AND (claimed_until IS NULL OR claimed_until < now())
                     ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
         RETURNING id, recipient, subject, body`, [CLAIM_SECONDS]);
      const message = claimed.rows[0];
      if (!message) return;
      try {
        await sendMail({ to: message.recipient, subject: message.subject, body: message.body });
      } catch {
        await pool.query("UPDATE outbox SET claimed_until = NULL WHERE id = $1", [message.id]);
        return;
      }
      await transaction(async (tx) => {
        await tx.query("UPDATE outbox SET status = 'sent', sent_at = now(), claimed_until = NULL WHERE id = $1", [message.id]);
        await notify(tx, { k: "outbox" });
      });
    }
  } finally {
    running = false;
  }
}
