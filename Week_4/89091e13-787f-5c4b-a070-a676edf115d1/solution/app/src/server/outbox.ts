import { maybeOne, pool, run, type Db } from "./db.ts";
import { sendMail } from "./smtp.ts";

const RETRY_SECONDS = 5;
let delivering = false;

let silenced = false;

/** The seed replays history without sending mail: "the seed itself sends no mail". */
export function silenceMail(on: boolean): void {
  silenced = on;
}

/** Writes a mail to the outbox inside the caller's transaction; the sender delivers it after commit. */
export async function enqueueMail(db: Db, recipient: string, subject: string, body: string): Promise<void> {
  if (silenced) return;
  await run(db, "INSERT INTO mail_outbox (recipient, subject, body) VALUES ($1, $2, $3)", [recipient, subject, body]);
}

/** Delivers every due mail once; a failure leaves the mail in the outbox for the next attempt. */
export async function deliverDueMail(): Promise<void> {
  if (delivering) return;
  delivering = true;
  try {
    for (;;) {
      const mail = await maybeOne<{ id: number; recipient: string; subject: string; body: string }>(
        pool,
        "SELECT id, recipient, subject, body FROM mail_outbox WHERE sent_at IS NULL AND next_attempt_at <= now() ORDER BY id LIMIT 1",
      );
      if (!mail) return;
      try {
        await sendMail(mail.recipient, mail.subject, mail.body);
        await run(pool, "UPDATE mail_outbox SET sent_at = now() WHERE id = $1", [mail.id]);
      } catch {
        await run(pool, "UPDATE mail_outbox SET next_attempt_at = now() + make_interval(secs => $2) WHERE id = $1", [mail.id, RETRY_SECONDS]);
      }
    }
  } finally {
    delivering = false;
  }
}
