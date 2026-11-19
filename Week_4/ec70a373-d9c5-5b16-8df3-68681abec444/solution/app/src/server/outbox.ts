// The email outbox: each message is written in its event's transaction and delivered by the worker.
import { pool, rows, type Db } from "./db.ts";
import { sendMail, type Message } from "./smtp.ts";

export async function enqueueMail(db: Db, message: Message): Promise<void> {
  await db.query("INSERT INTO outbox (to_address, subject, body) VALUES ($1, $2, $3)", [message.to, message.subject, message.body]);
}

interface OutboxRow {
  id: number;
  to_address: string;
  subject: string;
  body: string;
}

/**
 * Delivers due messages one at a time. Each claim locks one row for longer than an SMTP attempt can take,
 * so no other process picks it up while it is being sent; failures are retried two seconds later.
 */
export async function deliverOutbox(): Promise<void> {
  for (;;) {
    const [message] = await rows<OutboxRow>(
      pool,
      `UPDATE outbox SET locked_until = now() + interval '2 minutes'
        WHERE id = (SELECT id FROM outbox WHERE sent_at IS NULL AND (locked_until IS NULL OR locked_until < now())
                     ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id, to_address, subject, body`,
    );
    if (!message) return;
    try {
      await sendMail({ to: message.to_address, subject: message.subject, body: message.body });
      await pool.query("UPDATE outbox SET sent_at = now() WHERE id = $1", [message.id]);
    } catch (error) {
      console.error(`mail ${message.id} not sent yet:`, error instanceof Error ? error.message : error);
      await pool.query("UPDATE outbox SET locked_until = now() + interval '2 seconds' WHERE id = $1", [message.id]);
      return;
    }
  }
}
