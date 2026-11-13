import { pool } from './db.js';
import { sendMail, checkMail } from './mail.js';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Mail retry: a message is sent only after the server accepts it; on failure
 * it stays queued and is retried every 10 seconds. After 3 failed attempts
 * in total it is failed. Resend starts a fresh cycle.
 */
export async function attemptEmails(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const due = await pool.query(
      `SELECT * FROM emails WHERE status = 'queued' AND next_attempt <= now() ORDER BY created_at LIMIT 20`
    );
    for (const email of due.rows) {
      const ok = await sendMail(email.recipient, email.subject, email.body);
      if (ok) {
        await pool.query(`UPDATE emails SET status = 'sent', sent_at = now(), attempts = attempts + 1 WHERE id = $1`, [email.id]);
        // update the invite's latest email status
        if (email.invite_id) {
          await pool.query(
            `UPDATE invites SET email_status = 'sent' WHERE id = $1`,
            [email.invite_id]
          ).catch(() => undefined);
        }
      } else {
        const attempts = Number(email.attempts) + 1;
        const status = attempts >= 3 ? 'failed' : 'queued';
        await pool.query(
          `UPDATE emails SET status = $2, attempts = $3, next_attempt = now() + interval '10 seconds' WHERE id = $1`,
          [email.id, status, attempts]
        );
        if (email.invite_id) {
          await pool.query(
            `UPDATE invites SET email_status = $2 WHERE id = $1`,
            [email.invite_id, status]
          ).catch(() => undefined);
        }
      }
    }
  } finally {
    running = false;
  }
}

export function startMailQueue(): void {
  if (timer) return;
  void checkMail();
  timer = setInterval(() => { void attemptEmails(); }, 10_000);
  (timer as unknown as { unref?: () => void }).unref?.();
}
