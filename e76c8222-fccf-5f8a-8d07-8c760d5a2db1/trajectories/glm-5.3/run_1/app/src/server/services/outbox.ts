import { pool, withTransaction } from '../db.js';
import { sendMail } from './mail.js';
import { newId } from '../seed.js';

// Every email first goes into the Postgres outbox, then is delivered exactly once.
// Offers store the outbox message id, and their email field derives from its state.
export async function queueEmail(email: { to: string; subject: string; text: string }): Promise<string> {
  const id = newId('mail');
  await pool.query(
    `INSERT INTO outbox (id, message_id, to_email, subject, body, state, attempts, created_at, next_attempt_at)
     VALUES ($1,$2,$3,$4,$5,'queued',0,now(),now())`,
    [id, `outbox-${id}@fernhollow.test`, email.to, email.subject, email.text],
  );
  return id;
}

export async function runOutboxTick(ownerId: string): Promise<void> {
  const claimed = await withTransaction(async (client) => {
    const res = await client.query<{ id: string; message_id: string; to_email: string; subject: string; body: string }>(
      `UPDATE outbox SET state = 'sending', sending_owner = $1, attempts = attempts + 1, last_error = NULL
       WHERE id IN (
         SELECT id FROM outbox WHERE state = 'queued' AND next_attempt_at <= now()
         ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED
       ) RETURNING id, message_id, to_email, subject, body`,
      [ownerId],
    );
    return res.rows;
  });
  for (const msg of claimed) {
    try {
      await sendMail({ messageId: msg.message_id, to: msg.to_email, subject: msg.subject, text: msg.body });
      await pool.query(`UPDATE outbox SET state = 'sent', sent_at = now(), sending_owner = NULL WHERE id = $1`, [msg.id]);
    } catch {
      await pool.query(
        `UPDATE outbox SET state = 'queued', sending_owner = NULL, next_attempt_at = now() + interval '30 seconds', last_error = 'delivery failed' WHERE id = $1`,
        [msg.id],
      );
    }
  }
}
