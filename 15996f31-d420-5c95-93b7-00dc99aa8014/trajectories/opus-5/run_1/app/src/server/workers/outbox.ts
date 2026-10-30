import { pool, text } from '../db';
import { deliverEmail } from '../services/mail';

const RETRY_SECONDS = 10;
let pumping = false;

async function claimAndSend(): Promise<void> {
  for (;;) {
    const claimed = await pool.query(
      `update email_outbox set attempts = attempts + 1,
         next_attempt_at = now() + ($1 || ' seconds')::interval
        where id = (
          select id from email_outbox
           where status = 'pending' and next_attempt_at <= now()
           order by created_at limit 1 for update skip locked)
        returning id, to_email, subject, body`,
      [String(RETRY_SECONDS)],
    );
    const row = claimed.rows[0];
    if (row === undefined) return;
    try {
      await deliverEmail({
        to: text(row.to_email),
        subject: text(row.subject),
        body: text(row.body),
      });
    } catch {
      /* SMTP is unreachable from here; release it so another instance may send it. */
      await pool.query(
        `update email_outbox set next_attempt_at = now() where id = $1 and status = 'pending'`,
        [text(row.id)],
      );
      return;
    }
    await pool.query(`update email_outbox set status = 'sent', sent_at = now() where id = $1`, [
      text(row.id),
    ]);
  }
}

/** Claims due outbox rows one at a time and sends each exactly once. */
export async function pumpOutbox(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    await claimAndSend();
  } catch (error) {
    console.error('[email outbox] retrying after', error instanceof Error ? error.message : error);
  } finally {
    pumping = false;
  }
}
