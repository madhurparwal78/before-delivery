import { randomUUID } from 'node:crypto';
import { Db, db } from '../db/pool';
import { sendMail } from '../services/mailer';
import { publish } from '../services/live';
import { rupees } from './money';
import {
  CLAIM_STATUS_WORDS,
  ORDER_STATUS_WORDS,
  RETURN_STATUS_WORDS,
  TRIAL_STATUS_WORDS
} from './rules';

export function orderPlacedSubject(number: string): string {
  return `Your Roam House order ${number} is placed`;
}

export function orderStatusSubject(number: string, status: string): string {
  if (status === 'cancelled') return `Order ${number} is cancelled`;
  return `Order ${number}: ${ORDER_STATUS_WORDS[status]}`;
}

export function returnSubject(number: string, status: string): string {
  return `Return ${number}: ${RETURN_STATUS_WORDS[status]}`;
}

export function trialSubject(number: string, status: string): string {
  return `Trial return ${number}: ${TRIAL_STATUS_WORDS[status]}`;
}

export function warrantySubject(number: string, status: string): string {
  return `Warranty claim ${number}: ${CLAIM_STATUS_WORDS[status]}`;
}

export function statusBody(reference: string, statusWord: string, refundAmount: number | null): string {
  const lines = [`${reference} is now ${statusWord}.`];
  if (refundAmount !== null) lines.push(`Refund issued: ${rupees(refundAmount)}.`);
  return lines.join('\n');
}

export async function recordNotification(
  client: Db,
  userId: string,
  subject: string,
  body: string,
  status: 'pending' | 'emailed'
): Promise<string> {
  const id = randomUUID();
  await client.query(
    'INSERT INTO notifications (id, user_id, text, body, email_status, attempts) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, userId, subject, body, status, status === 'emailed' ? 1 : 0]
  );
  await publish(client, 'notification', { text: subject, email_status: status }, { userId });
  return id;
}

export async function sendPendingNotifications(): Promise<void> {
  const rows = await db.query<{ id: string; user_id: string; text: string; body: string }>(
    `SELECT id, user_id, text, body FROM notifications
     WHERE email_status = 'pending' ORDER BY at ASC LIMIT 20`
  );
  for (const row of rows) {
    const user = await db.one<{ email: string }>('SELECT email FROM users WHERE id = $1', [row.user_id]);
    if (user === null) continue;
    const claimed = await db.one<{ id: string }>(
      `UPDATE notifications SET attempts = attempts + 1
       WHERE id = $1 AND email_status = 'pending' RETURNING id`,
      [row.id]
    );
    if (claimed === null) continue;
    try {
      await sendMail({ to: user.email, subject: row.text, body: row.body });
      await db.query("UPDATE notifications SET email_status = 'emailed' WHERE id = $1", [row.id]);
      await publish(db, 'notification', { text: row.text, email_status: 'emailed' }, { userId: row.user_id });
    } catch {
      // Left pending; the next sweep tries again.
    }
  }
}

export function startMailWorker(): void {
  setInterval(() => {
    void sendPendingNotifications().catch(() => undefined);
  }, 2000);
}
