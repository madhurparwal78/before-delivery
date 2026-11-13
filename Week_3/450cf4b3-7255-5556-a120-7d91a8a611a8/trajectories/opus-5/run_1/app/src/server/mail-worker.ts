import { config } from './config';
import { pool, query } from './db';
import { deliver } from './services/smtp';
import { senderAddress } from './domain/mail';

interface ClaimedMail {
  id: string;
  to_name: string;
  to_email: string;
  subject: string;
  body: string;
  created_at: Date;
}

const BATCH = 10;
let running = false;

/** Claims queued emails one process at a time and delivers them until acknowledged. */
export async function drainMailQueue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const client = await pool.connect();
      let claimed: ClaimedMail[] = [];
      try {
        await client.query('begin');
        claimed = await query<ClaimedMail>(
          client,
          `update mail_queue set claimed_at = now(), attempts = attempts + 1
           where id in (
             select id from mail_queue
             where status = 'queued' and (claimed_at is null or claimed_at < now() - interval '30 seconds')
             order by id
             limit ${BATCH}
             for update skip locked
           )
           returning id::text as id, to_name, to_email, subject, body, created_at`,
        );
        await client.query('commit');
      } catch {
        await client.query('rollback').catch(() => undefined);
      } finally {
        client.release();
      }
      if (claimed.length === 0) return;

      for (const mail of claimed) {
        try {
          await deliver({
            fromAddress: senderAddress(),
            fromHeader: config.mail.from,
            toName: mail.to_name,
            toEmail: mail.to_email,
            subject: mail.subject,
            body: mail.body,
            messageId: `<queue-${mail.id}@stationhouse.test>`,
            date: mail.created_at,
          });
          await pool.query(
            `update mail_queue set status = 'sent', sent_at = now() where id = $1 and status = 'queued'`,
            [mail.id],
          );
        } catch {
          // The email stays queued and is retried by whichever process reaches mail next.
        }
      }
    }
  } finally {
    running = false;
  }
}

export function startMailWorker(): void {
  void drainMailQueue();
  setInterval(() => {
    void drainMailQueue();
  }, 30_000).unref();
}

/** Called right after an action that queued an email. */
export function nudgeMailQueue(): void {
  setTimeout(() => {
    void drainMailQueue();
  }, 10).unref();
}
