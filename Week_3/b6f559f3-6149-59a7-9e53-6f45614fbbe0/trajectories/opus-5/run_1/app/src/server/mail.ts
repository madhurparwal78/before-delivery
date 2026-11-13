import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query } from './db';
import { serverNow } from './clock';
import { sendMail } from './smtp';

export interface OutboxMail {
  kind: 'invite' | 'publish';
  toEmail: string;
  subject: string;
  body: string;
  projectId: string | null;
  versionNumber: number | null;
  inviteId: string | null;
}

interface OutboxRow {
  id: string;
  to_email: string;
  subject: string;
  body: string;
}

/** Every mail is written to the outbox in the same transaction as its change. */
export async function enqueueMail(client: PoolClient, mail: OutboxMail): Promise<string> {
  const id = randomUUID();
  const now = await serverNow();
  await client.query(
    `INSERT INTO outbox (id, kind, to_email, subject, body, status, project_id, version_number, invite_id, created_at)
     VALUES ($1,$2,$3,$4,$5,'queued',$6,$7,$8,$9)`,
    [
      id,
      mail.kind,
      mail.toEmail,
      mail.subject,
      mail.body,
      mail.projectId,
      mail.versionNumber,
      mail.inviteId,
      now.toISOString(),
    ],
  );
  return id;
}

async function sendOne(row: OutboxRow): Promise<boolean> {
  try {
    await sendMail({ to: row.to_email, subject: row.subject, body: row.body });
    return true;
  } catch {
    return false;
  }
}

/** Claims each queued row in a transaction so every mail leaves exactly once. */
export async function flushOutbox(): Promise<void> {
  const claimed = await query<OutboxRow>(
    `UPDATE outbox SET claimed_at = now()
     WHERE id IN (
       SELECT id FROM outbox WHERE status = 'queued'
       ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED
     )
     RETURNING id, to_email, subject, body`,
  );
  for (const row of claimed) {
    const sent = await sendOne(row);
    if (sent) {
      const now = await serverNow();
      await query(`UPDATE outbox SET status = 'sent', sent_at = $2 WHERE id = $1`, [
        row.id,
        now.toISOString(),
      ]);
    } else {
      await query(`UPDATE outbox SET claimed_at = NULL WHERE id = $1`, [row.id]);
    }
  }
}

export function startOutboxWorker(): void {
  const run = (): void => {
    flushOutbox().catch(() => undefined);
  };
  run();
  setInterval(run, 10000).unref();
}

export async function noticeStatus(
  projectId: string,
  versionNumber: number,
): Promise<'sent' | 'queued'> {
  const rows = await query<{ status: string }>(
    `SELECT status FROM outbox WHERE project_id = $1 AND version_number = $2`,
    [projectId, versionNumber],
  );
  return rows.some((row) => row.status === 'queued') ? 'queued' : 'sent';
}

export async function inviteStatus(inviteId: string): Promise<'sent' | 'queued'> {
  const rows = await query<{ status: string }>(
    `SELECT status FROM outbox WHERE invite_id = $1`,
    [inviteId],
  );
  return rows.some((row) => row.status === 'queued') ? 'queued' : 'sent';
}
