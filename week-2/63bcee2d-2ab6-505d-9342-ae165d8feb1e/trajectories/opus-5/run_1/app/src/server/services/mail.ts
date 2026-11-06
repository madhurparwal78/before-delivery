/**
 * Mail over SMTP. Messages are written to the outbox in the same unit as the
 * change that caused them, then delivered exactly once by whichever copy of the
 * app claims them.
 */

import { config, MAIL_FROM, MAIL_FROM_ADDRESS } from '../config.js';
import { newId } from '../db/ids.js';
import { pool, rows, type Queryable } from '../db/pool.js';
import { hasLineBreak } from '../../shared/chars.js';
import { sendMail } from './smtp.js';

export interface OutgoingMail {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
  calendar?: { fileName: string; content: string };
}

/** Writes one message to the outbox inside the caller's transaction. */
export async function queueMail(client: Queryable, mail: OutgoingMail): Promise<void> {
  if (hasLineBreak(mail.subject)) {
    throw new Error('A subject line may never contain a line break');
  }
  await client.query(
    `INSERT INTO outbox (id, to_email, subject, body, reply_to, ics_filename, ics_body)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      newId(),
      mail.to,
      mail.subject,
      mail.body,
      mail.replyTo ?? null,
      mail.calendar?.fileName ?? null,
      mail.calendar?.content ?? null,
    ],
  );
}

interface OutboxRow {
  id: string;
  to_email: string;
  subject: string;
  body: string;
  reply_to: string | null;
  ics_filename: string | null;
  ics_body: string | null;
}

async function deliverBatch(): Promise<number> {
  const claimed = await rows<OutboxRow>(
    pool,
    `UPDATE outbox SET claimed_until = now() + interval '30 seconds', attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM outbox
          WHERE sent_at IS NULL AND (claimed_until IS NULL OR claimed_until < now())
          ORDER BY created_at
          LIMIT 20
          FOR UPDATE SKIP LOCKED
       )
     RETURNING id, to_email, subject, body, reply_to, ics_filename, ics_body`,
  );

  for (const message of claimed) {
    try {
      await sendMail(config.smtp, {
        from: MAIL_FROM,
        fromAddress: MAIL_FROM_ADDRESS,
        to: message.to_email,
        subject: message.subject,
        text: message.body,
        ...(message.reply_to ? { replyTo: message.reply_to } : {}),
        ...(message.ics_filename && message.ics_body
          ? {
              attachment: {
                fileName: message.ics_filename,
                contentType: 'text/calendar; method=REQUEST',
                content: message.ics_body,
              },
            }
          : {}),
      });
      await pool.query('UPDATE outbox SET sent_at = now(), claimed_until = NULL WHERE id = $1', [
        message.id,
      ]);
    } catch {
      await pool.query('UPDATE outbox SET claimed_until = NULL WHERE id = $1', [message.id]);
    }
  }
  return claimed.length;
}

let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await deliverBatch();
  } catch {
    // The database is unreachable; the next tick tries again.
  } finally {
    running = false;
  }
}

export function startMailDelivery(): void {
  setInterval(() => void tick(), 1000).unref();
}

/** Nudges delivery straight after an action queued a message. */
export function nudgeMailDelivery(): void {
  setTimeout(() => void tick(), 10);
}
