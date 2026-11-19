import { config } from './config.js';
import { db, type Queryable } from './db.js';
import { sendMail } from './smtp.js';

export interface Notice {
  to: string;
  subject: string;
  body: string;
}

export async function enqueueMail(tx: Queryable, notice: Notice, now: Date): Promise<void> {
  await tx.query('insert into outbox (to_email, subject, body, created_at) values ($1,$2,$3,$4)', [
    notice.to,
    notice.subject,
    notice.body,
    now,
  ]);
}

let draining = false;

export async function drainOutbox(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const pending = await db.query<{
      id: number;
      to_email: string;
      subject: string;
      body: string;
      created_at: Date;
    }>(
      `select id, to_email, subject, body, created_at from outbox
       where sent_at is null and (last_attempt_at is null or last_attempt_at < now() - interval '10 seconds')
       order by id asc limit 25`,
    );
    for (const row of pending.rows) {
      await db.query('update outbox set attempts = attempts + 1, last_attempt_at = now() where id = $1', [row.id]);
      try {
        await sendMail(config.smtp.host, config.smtp.port, {
          from: config.smtp.from,
          to: row.to_email,
          subject: row.subject,
          body: row.body,
          date: row.created_at,
        });
        await db.query('update outbox set sent_at = now() where id = $1', [row.id]);
      } catch {
        // The cause already succeeded; the next sweep retries this notice.
      }
    }
  } finally {
    draining = false;
  }
}

export function startMailer(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void drainOutbox();
  }, 2000);
  timer.unref();
  return timer;
}
