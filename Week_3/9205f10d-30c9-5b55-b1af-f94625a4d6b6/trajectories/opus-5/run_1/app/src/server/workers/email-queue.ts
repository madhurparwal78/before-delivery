import { transact } from '../db.js';
import { sendMail } from '../services/smtp.js';

const INTERVAL_MS = 10_000;
const BATCH = 20;

interface PendingEmail {
  id: string;
  to_address: string;
  subject: string;
  body: string;
}

async function drainOnce(): Promise<void> {
  await transact(async (client) => {
    const pending = await client.query<PendingEmail>(
      `SELECT id, to_address, subject, body FROM outgoing_emails
        WHERE sent_at IS NULL
        ORDER BY created_at
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED`,
    );
    for (const email of pending.rows) {
      try {
        await sendMail(email.to_address, email.subject, email.body);
        await client.query(`UPDATE outgoing_emails SET sent_at = now() WHERE id = $1`, [email.id]);
      } catch {
        await client.query(`UPDATE outgoing_emails SET attempts = attempts + 1 WHERE id = $1`, [
          email.id,
        ]);
      }
    }
  });
}

export function startEmailQueue(): void {
  const tick = (): void => {
    void drainOnce().catch(() => undefined);
  };
  tick();
  setInterval(tick, INTERVAL_MS).unref();
}
