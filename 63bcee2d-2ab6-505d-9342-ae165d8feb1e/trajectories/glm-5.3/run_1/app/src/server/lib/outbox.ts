// Outbox: mail queued in the same unit as the change that caused it,
// delivered by a background loop with retries. Multiple app copies may run.

import { randomUUID } from 'node:crypto';
import { pool, query } from './db.js';
import { sendMail, type MailMessage } from './mail.js';

const FROM = 'Plumbline <plumbline@marrowhall.example>';

export async function queueMail(message: MailMessage): Promise<void> {
  await query(
    'INSERT INTO outbox (id, to_email, subject, body, ics, reply_to) VALUES ($1, $2, $3, $4, $5, $6)',
    [randomUUID(), message.to, message.subject, message.body, message.ics ?? null, message.replyTo ?? null],
  );
}

export async function queueMany(messages: MailMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const values: unknown[][] = messages.map((m) => [randomUUID(), m.to, m.subject, m.body, m.ics ?? null, m.replyTo ?? null]);
  const params: unknown[] = [];
  const tuples = values.map((row) => {
    const placeholders = row.map((_, i) => `$${params.push(_)}`);
    return `(${placeholders.join(',')})`;
  });
  await query(
    `INSERT INTO outbox (id, to_email, subject, body, ics, reply_to) VALUES ${tuples.join(',')}`,
    params,
  );
}

export function startDeliveryLoop(host: string, port: number): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await deliverPending(host, port);
    } catch (error) {
      console.error('outbox tick failed:', (error as Error).message);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(tick, 10_000);
}

async function deliverPending(host: string, port: number): Promise<void> {
  // Claim rows with SKIP LOCKED so concurrent copies never double-send; a claim
  // expires if a copy dies, and the next pass retries.
  const client = await pool.connect();
  try {
    const claimed = await client.query(
      `UPDATE outbox SET claimed_until = now() + interval '30 seconds'
       WHERE id IN (
         SELECT id FROM outbox
         WHERE sent_at IS NULL AND (claimed_until IS NULL OR claimed_until < now())
         ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED
       ) RETURNING id, to_email, subject, body, ics, reply_to`,
    );
    for (const row of claimed.rows as {
      id: string;
      to_email: string;
      subject: string;
      body: string;
      ics: string | null;
      reply_to: string | null;
    }[]) {
      try {
        await sendMail(host, port, FROM, {
          to: row.to_email,
          subject: row.subject,
          body: row.body,
          ics: row.ics ?? undefined,
          replyTo: row.reply_to ?? undefined,
        });
        await client.query('UPDATE outbox SET sent_at = now(), attempts = attempts + 1 WHERE id = $1', [row.id]);
      } catch (error) {
        console.error('outbox send failed:', (error as Error).message);
        await client.query('UPDATE outbox SET attempts = attempts + 1, claimed_until = NULL WHERE id = $1', [row.id]);
      }
    }
  } finally {
    client.release();
  }
}
