import { config } from '../config';
import { type Db, query, withClient } from '../db';
import { newUuid } from '../domain/ids';
import type { DraftMessage } from './messages';
import { sendMail } from './smtp';

export async function enqueueMessage(db: Db, message: DraftMessage): Promise<void> {
  await db.query(
    `insert into outbox (id, recipient, subject, kind, body, status) values ($1, $2, $3, $4, $5, 'queued')`,
    [newUuid(), message.recipient, message.subject, message.kind, message.body],
  );
}

interface QueuedRow {
  id: string;
  recipient: string;
  subject: string;
  body: string;
}

/**
 * Sends queued mail. A message is held under a session advisory lock while it is being sent, so
 * only one copy of the server sends it, and a failed send leaves it queued for the next sweep.
 */
export async function pumpOutbox(): Promise<void> {
  const candidates = await query<QueuedRow>(
    `select id, recipient, subject, body from outbox where status = 'queued' order by created_at, id limit 20`,
  );
  for (const message of candidates) {
    await withClient(async (client) => {
      const claim = await client.query<{ got: boolean }>(`select pg_try_advisory_lock(hashtext($1)::bigint) as got`, [
        message.id,
      ]);
      if (!claim.rows[0]?.got) return;
      try {
        const fresh = await client.query<{ status: string }>(`select status from outbox where id = $1`, [message.id]);
        if (fresh.rows[0]?.status !== 'queued') return;
        await client.query(`update outbox set attempts = attempts + 1, claimed_at = now() where id = $1`, [
          message.id,
        ]);
        await sendMail(config.smtp.host, config.smtp.port, {
          from: config.mailFrom,
          to: message.recipient,
          subject: message.subject,
          text: message.body,
        });
        await client.query(`update outbox set status = 'sent', sent_at = now() where id = $1`, [message.id]);
      } catch {
        // The message stays queued, and the next sweep tries again.
      } finally {
        await client.query(`select pg_advisory_unlock(hashtext($1)::bigint)`, [message.id]);
      }
    });
  }
}
