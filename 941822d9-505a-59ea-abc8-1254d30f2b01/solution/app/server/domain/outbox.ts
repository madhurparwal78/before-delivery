import { pool, type Db } from "../db.js";
import { sendMail } from "../services/smtp.js";

// The email outbox: each event queues exactly one message in the transaction that caused it; delivery retries until sent.

interface OutgoingMail {
  /** One key per event, so a replay or a second worker can never queue the same message twice. */
  eventKey: string;
  to: string;
  subject: string;
  text: string;
}

export async function queueMail(t: Db, mail: OutgoingMail, now: Date): Promise<void> {
  await t.q(
    `INSERT INTO outbox (event_key, to_address, subject, body, created_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (event_key) DO NOTHING`,
    [mail.eventKey, mail.to, mail.subject, mail.text, now],
  );
}

let delivering = false;

/** Sends every queued message; a message whose delivery fails stays queued for the next pass. */
export async function deliverOutbox(): Promise<void> {
  if (delivering) return;
  delivering = true;
  try {
    for (;;) {
      const client = await pool.connect();
      let sent = 0;
      try {
        await client.query("BEGIN");
        const { rows } = await client.query<{ id: number; to_address: string; subject: string; body: string }>(
          `SELECT id, to_address, subject, body FROM outbox WHERE sent_at IS NULL
            ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED`,
        );
        for (const row of rows) {
          try {
            await sendMail({ to: row.to_address, subject: row.subject, text: row.body });
            await client.query("UPDATE outbox SET sent_at = now(), attempts = attempts + 1 WHERE id = $1", [row.id]);
            sent += 1;
          } catch (error) {
            console.error("mail delivery failed, will retry:", error instanceof Error ? error.message : String(error));
            await client.query("UPDATE outbox SET attempts = attempts + 1 WHERE id = $1", [row.id]);
          }
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      if (sent === 0) return;
    }
  } finally {
    delivering = false;
  }
}

/** Delivers soon after a commit instead of waiting for the next pass. */
export const nudgeOutbox = (): void => {
  setImmediate(() => deliverOutbox().catch((error: unknown) => console.error("outbox:", error instanceof Error ? error.message : String(error))));
};
