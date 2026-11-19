import { transaction, type Tx } from "./db.js";
import { sendMail } from "./mail.js";

interface Notice {
  to: string;
  subject: string;
  text: string;
}

export async function queueNotice(tx: Tx, notice: Notice): Promise<void> {
  await tx.query("INSERT INTO mail_outbox (to_address, subject, body) VALUES ($1, $2, $3)", [notice.to, notice.subject, notice.text]);
}

let draining = false;

/** Sends every waiting notice once. A failure leaves the notice queued for the next pass, so it never rejects. */
export async function drainOutbox(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    let sent = true;
    while (sent) {
      sent = await transaction(async (tx) => {
        const next = await tx.query<{ id: string; to_address: string; subject: string; body: string }>(
          "SELECT id, to_address, subject, body FROM mail_outbox WHERE sent_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",
        );
        const row = next.rows[0];
        if (!row) return false;
        try {
          await sendMail({ to: row.to_address, subject: row.subject, text: row.body });
        } catch {
          return false;
        }
        await tx.query("UPDATE mail_outbox SET sent_at = clock_timestamp() WHERE id = $1", [row.id]);
        return true;
      });
    }
  } catch {
    return;
  } finally {
    draining = false;
  }
}
