import type { Queryable } from '../db.js';
import { query, withTransaction } from '../db.js';
import { now } from '../clock.js';
import { deliver, probeSmtp, type OutgoingMail } from './smtp.js';

let mailUp = true;

export function mailIsUp(): boolean {
  return mailUp;
}

export async function enqueueMail(client: Queryable, mail: OutgoingMail, at: Date): Promise<void> {
  await client.query(
    'INSERT INTO mail_queue (to_address, subject, body, created_at) VALUES ($1, $2, $3, $4)',
    [mail.to, mail.subject, mail.body, at.toISOString()]
  );
}

export async function queuedMailCount(): Promise<number> {
  const { rows } = await query<{ pending: number }>(
    'SELECT COUNT(*)::int AS pending FROM mail_queue WHERE sent_at IS NULL'
  );
  return Number(rows[0]?.pending ?? 0);
}

type ClaimedMail = { id: number; to_address: string; subject: string; body: string };

async function sendBatch(): Promise<void> {
  const at = now();
  const claimed = await withTransaction(async (client) => {
    const { rows } = await client.query<ClaimedMail>(
      `UPDATE mail_queue SET claimed_at = $1, attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM mail_queue
           WHERE sent_at IS NULL AND (claimed_at IS NULL OR claimed_at < $2)
           ORDER BY id
           FOR UPDATE SKIP LOCKED
           LIMIT 20
        )
        RETURNING id, to_address, subject, body`,
      [at.toISOString(), new Date(at.getTime() - 30_000).toISOString()]
    );
    return rows;
  });

  if (claimed.length === 0) {
    try {
      await probeSmtp();
      mailUp = true;
    } catch {
      mailUp = false;
    }
    return;
  }

  for (const row of claimed) {
    try {
      await deliver({ to: row.to_address, subject: row.subject, body: row.body }, now());
      await query('UPDATE mail_queue SET sent_at = $2 WHERE id = $1', [
        row.id,
        now().toISOString()
      ]);
      mailUp = true;
    } catch {
      mailUp = false;
      await query('UPDATE mail_queue SET claimed_at = NULL WHERE id = $1', [row.id]);
    }
  }
}

export function startMailSender(): void {
  const tick = (): void => {
    void sendBatch().catch(() => {
      /* the next tick retries */
    });
  };
  tick();
  setInterval(tick, 5000).unref();
}
