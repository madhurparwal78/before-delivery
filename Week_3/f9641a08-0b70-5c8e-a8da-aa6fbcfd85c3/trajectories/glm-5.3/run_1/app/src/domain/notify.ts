import type { Client } from '../db/pool.js';
import { publish } from './events.js';
import { sendEmail } from '../services/mail.js';

/**
 * One place that writes a customer notification, queues its email and marks
 * it emailed only after the mail server accepts the message.
 */
export async function notify(
  client: Client,
  userId: number,
  email: string,
  subject: string,
  body: string,
): Promise<void> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO notifications (user_id, text, email_status) VALUES ($1, $2, 'pending') RETURNING id::TEXT AS id`,
    [userId, subject]);
  const id = Number(res.rows[0].id);
  await publish(client, 'notification', { text: subject, email_status: 'pending' }, { userId, sessionId: null, staffVisible: true });
  // The email is handed to the mail server inside the caller's transaction.
  const sent = await sendEmail(email, subject, body);
  if (sent) {
    await client.query(`UPDATE notifications SET email_status = 'emailed', emailed_at = now() WHERE id = $1`, [id]);
    await publish(client, 'notification', { text: subject, email_status: 'emailed' }, { userId, sessionId: null, staffVisible: true });
  }
}

/** Retries pending emails; each is accepted exactly once. */
export async function retryPendingEmails(client: Client): Promise<void> {
  const res = await client.query<{ id: string; user_id: string; text: string; email: string }>(`
    SELECT n.id::TEXT AS id, n.user_id::TEXT AS user_id, n.text, u.email
    FROM notifications n JOIN users u ON u.id = n.user_id
    WHERE n.email_status = 'pending'
    ORDER BY n.id LIMIT 20`);
  for (const row of res.rows) {
    const sent = await sendEmail(row.email, row.text, bodyFor(row.text));
    if (sent) {
      await client.query(`UPDATE notifications SET email_status = 'emailed', emailed_at = now() WHERE id = $1`, [Number(row.id)]);
      await publish(client, 'notification', { text: row.text, email_status: 'emailed' }, { userId: Number(row.user_id), sessionId: null, staffVisible: true });
    }
  }
}

function bodyFor(subject: string): string {
  return `${subject}\n\nRoam House\n`;
}
