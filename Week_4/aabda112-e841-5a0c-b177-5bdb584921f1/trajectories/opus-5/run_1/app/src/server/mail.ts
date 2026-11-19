import nodemailer from 'nodemailer';
import { config } from './config';
import { newId, query } from './db';
import { serverNow } from './clock';

const transport = nodemailer.createTransport({
  host: config.smtpHost,
  port: config.smtpPort,
  secure: false,
  ignoreTLS: true,
  tls: { rejectUnauthorized: false },
});

export type Mail = { to: string; subject: string; body: string };

async function deliver(mail: Mail): Promise<boolean> {
  try {
    await transport.sendMail({
      from: config.mailFrom,
      to: mail.to,
      subject: mail.subject,
      text: mail.body,
    });
    return true;
  } catch {
    return false;
  }
}

/** Queues one message with one recipient in Postgres, then tries to deliver it. */
export async function sendMail(mail: Mail): Promise<boolean> {
  const id = newId();
  await query(
    'insert into mail_queue (id, to_address, subject, body, attempts) values ($1,$2,$3,$4,1)',
    [id, mail.to, mail.subject, mail.body],
  );
  const accepted = await deliver(mail);
  if (accepted) {
    await query('update mail_queue set status = $2, sent_at = $3 where id = $1', [
      id,
      'sent',
      new Date(serverNow()).toISOString(),
    ]);
  }
  return accepted;
}

export async function retryQueuedMail(): Promise<void> {
  const rows = await query<{ id: string; to_address: string; subject: string; body: string }>(
    `select id, to_address, subject, body from mail_queue
      where status = 'pending' and attempts < 200 order by created_at limit 20`,
  );
  for (const row of rows) {
    const accepted = await deliver({ to: row.to_address, subject: row.subject, body: row.body });
    await query(
      `update mail_queue set attempts = attempts + 1,
         status = case when $2 then 'sent' else status end,
         sent_at = case when $2 then $3 else sent_at end
       where id = $1`,
      [row.id, accepted, new Date(serverNow()).toISOString()],
    );
  }
}
