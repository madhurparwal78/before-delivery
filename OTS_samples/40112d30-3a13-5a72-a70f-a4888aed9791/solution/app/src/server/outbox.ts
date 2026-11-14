import type { Db } from './db.ts';
import { pool } from './db.ts';
import { sendMail } from './smtp.ts';

// Every email is first written to the outbox in the same transaction as the action that causes it, then delivered
// and marked sent once, and retried while Mailpit is unreachable (brief: Services, Mailpit).

const RETRY_SECONDS = 20;
const SWEEP_MS = 5_000;
const BATCH = 20;

export async function enqueue(tx: Db, to: string, subject: string, body: string): Promise<number> {
  const { rows } = await tx.query<{ id: string }>(
    'INSERT INTO outbox (to_address, subject, body) VALUES ($1, $2, $3) RETURNING id',
    [to, subject, body],
  );
  return Number(rows[0]?.id);
}

interface Pending { id: string; to_address: string; subject: string; body: string }

async function deliver(ids: number[] | null): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<Pending>(
      `SELECT id, to_address, subject, body FROM outbox
       WHERE sent_at IS NULL AND ($1::bigint[] IS NULL OR id = ANY($1)) AND ($1::bigint[] IS NOT NULL OR next_attempt_at <= now())
       ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED`,
      [ids, BATCH],
    );
    for (const mail of rows) {
      try {
        await sendMail(mail.to_address, mail.subject, mail.body);
        await client.query('UPDATE outbox SET sent_at = now(), attempts = attempts + 1 WHERE id = $1', [mail.id]);
      } catch {
        await client.query(
          `UPDATE outbox SET attempts = attempts + 1, next_attempt_at = now() + make_interval(secs => $2) WHERE id = $1`,
          [mail.id, RETRY_SECONDS],
        );
      }
    }
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
  } finally {
    client.release();
  }
}

/** Try to deliver these rows now; true for each one Mailpit accepted. */
export async function deliverNow(ids: number[]): Promise<boolean[]> {
  await deliver(ids);
  const { rows } = await pool.query<{ id: string; sent: boolean }>(
    'SELECT id, sent_at IS NOT NULL AS sent FROM outbox WHERE id = ANY($1)', [ids],
  );
  return ids.map((id) => rows.some((row) => Number(row.id) === id && row.sent));
}

export function startOutbox(): void {
  setInterval(() => { void deliver(null); }, SWEEP_MS).unref();
}
