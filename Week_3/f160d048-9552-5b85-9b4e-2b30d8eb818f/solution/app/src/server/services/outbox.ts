import { pool } from "../db/pool";
import { config } from "../config";
import { sendMail, smtpReachable } from "./smtp";

let sending = false;

/** Sends every due outbox row exactly once, only while this instance's own SMTP server answers. */
export async function sendDueMail(): Promise<void> {
  if (sending) return;
  sending = true;
  try {
    if (!(await smtpReachable())) return;
    for (;;) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const claimed = await client.query<{ id: number; to_address: string; subject: string; body: string }>(
          `SELECT id, to_address, subject, body FROM outbox
            WHERE sent_at IS NULL AND next_attempt_at <= app_now()
            ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        );
        const row = claimed.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return;
        }
        try {
          await sendMail(row.to_address, row.subject, row.body);
          await client.query("UPDATE outbox SET sent_at = app_now() WHERE id = $1", [row.id]);
        } catch {
          await client.query("UPDATE outbox SET next_attempt_at = app_now() + make_interval(secs => $2) WHERE id = $1", [
            row.id,
            config.limits.outboxRetrySeconds,
          ]);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    sending = false;
  }
}

export async function pendingMail(): Promise<number> {
  const result = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM outbox WHERE sent_at IS NULL");
  return result.rows[0]?.n ?? 0;
}
