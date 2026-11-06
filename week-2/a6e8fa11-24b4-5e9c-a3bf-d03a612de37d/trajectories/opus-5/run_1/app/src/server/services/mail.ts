import { PoolClient } from 'pg';
import { query } from '../db';
import { uuid } from '../secrets';
import { sendMessage, smtpIsUp } from './smtp';

export interface QueuedMessage {
  to: string;
  subject: string;
  body: string;
}

/** Messages are written to the queue in the same transaction as the action that causes them. */
export async function queueMail(client: PoolClient, message: QueuedMessage): Promise<void> {
  await client.query(
    "insert into mail_queue (id, to_email, subject, body, status) values ($1,$2,$3,$4,'queued')",
    [uuid(), message.to, message.subject, message.body],
  );
}

interface MailRow {
  id: string;
  to_email: string;
  subject: string;
  body: string;
}

export async function sendQueuedMail(): Promise<void> {
  const rows = await query<MailRow>(
    `update mail_queue set status = 'sending', attempts = attempts + 1
     where id in (
       select id from mail_queue where status = 'queued' order by created_at asc limit 10 for update skip locked
     )
     returning id, to_email, subject, body`,
  );
  for (const row of rows) {
    try {
      await sendMessage({ to: row.to_email, subject: row.subject, body: row.body });
      await query("update mail_queue set status = 'sent', sent_at = now() where id = $1", [row.id]);
    } catch {
      await query("update mail_queue set status = 'queued' where id = $1", [row.id]);
    }
  }
}

export async function mailIsUp(): Promise<boolean> {
  return smtpIsUp();
}
