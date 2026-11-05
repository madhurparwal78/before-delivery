import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import type { Message } from '../services/mail';
import { sendMessage } from '../services/mail';

/** Queues a message in the same transaction as the thing that caused it. */
export async function queueMessage(client: PoolClient, message: Message): Promise<void> {
  await client.query('insert into outbox (to_email, subject, body) values ($1, $2, $3)', [
    message.to,
    message.subject,
    message.body,
  ]);
}

/**
 * Sends what is waiting. Rows are claimed with a row lock, so instances
 * sharing the database each send a different message, exactly once.
 */
export async function flushOutbox(): Promise<void> {
  for (;;) {
    const client = await pool.connect();
    let sentOne = false;
    try {
      await client.query('begin');
      const claimed = await client.query<{
        id: string;
        to_email: string;
        subject: string;
        body: string;
      }>(
        `select id, to_email, subject, body from outbox
         where sent_at is null order by id for update skip locked limit 1`,
      );
      const row = claimed.rows[0];
      if (row) {
        try {
          await sendMessage({ to: row.to_email, subject: row.subject, body: row.body });
          await client.query('update outbox set sent_at = now(), attempts = attempts + 1 where id = $1', [
            row.id,
          ]);
          sentOne = true;
        } catch {
          await client.query('update outbox set attempts = attempts + 1 where id = $1', [row.id]);
        }
      }
      await client.query('commit');
    } catch {
      await client.query('rollback');
    } finally {
      client.release();
    }
    if (!sentOne) return;
  }
}
