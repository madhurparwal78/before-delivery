import type { PoolClient } from '../db';
import { query, rows } from '../db';
import { randomId } from '../crypto/seal';
import { sendMail } from './smtp';

/** Mail waits in Postgres, so the triggering action succeeds even when Mailpit is unreachable. */
export async function queueMail(client: PoolClient, recipient: string, subject: string, body: string): Promise<void> {
  await client.query('insert into mail_outbox (id, recipient, subject, body, created_at) values ($1, $2, $3, $4, now())', [
    randomId('mail'),
    recipient,
    subject,
    body,
  ]);
}

export async function ownerEmails(client: PoolClient, slug: string): Promise<string[]> {
  const found = await rows<{ email: string }>(
    client,
    `select u.email from memberships m join users u on u.id = m.user_id
     where m.workspace_slug = $1 and m.role = 'owner' order by u.email`,
    [slug],
  );
  return found.map((item) => item.email);
}

export async function flushMailOutbox(): Promise<void> {
  const pending = await query<{ id: string; recipient: string; subject: string; body: string }>(
    'select id, recipient, subject, body from mail_outbox where sent_at is null order by created_at limit 25',
  );
  for (const message of pending) {
    try {
      await sendMail({ to: message.recipient, subject: message.subject, text: message.body });
      await query('update mail_outbox set sent_at = now() where id = $1', [message.id]);
    } catch {
      await query('update mail_outbox set attempts = attempts + 1 where id = $1', [message.id]);
    }
  }
}
