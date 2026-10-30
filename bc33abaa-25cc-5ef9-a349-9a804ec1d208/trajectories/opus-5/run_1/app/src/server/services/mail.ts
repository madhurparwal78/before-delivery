import { PoolClient } from 'pg';
import { config } from '../config';
import { pool, query } from '../db/pool';
import { randomId } from '../util/crypto';
import { sendMail } from './smtp';

function parseFrom(): { name: string; address: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(config.mail.from);
  if (match) return { name: match[1] ?? '', address: match[2] as string };
  return { name: '', address: config.mail.from.trim() };
}

const defaultFrom = parseFrom();

/** Removes control characters so no header can be split or injected. */
export function headerSafe(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

export interface OutgoingMail {
  dedupeKey: string;
  workspaceId: string | null;
  to: string[];
  subject: string;
  body: string;
  fromName?: string;
}

export async function enqueueMail(mail: OutgoingMail, client?: PoolClient): Promise<void> {
  const runner = client ?? pool;
  await runner.query(
    `INSERT INTO mail_outbox (id, dedupe_key, workspace_id, recipients, from_name, subject, body)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [
      randomId('mail'),
      mail.dedupeKey,
      mail.workspaceId,
      JSON.stringify(mail.to),
      mail.fromName ? headerSafe(mail.fromName) : null,
      headerSafe(mail.subject),
      mail.body,
    ],
  );
  setTimeout(() => void drainOutbox(), 0);
}

let draining = false;

export async function drainOutbox(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    // One claim per message, so two serve instances never send it twice.
    const rows = await query<{
      id: string;
      recipients: string[];
      from_name: string | null;
      subject: string;
      body: string;
    }>(
      `UPDATE mail_outbox SET claimed_at = now()
       WHERE id IN (
         SELECT id FROM mail_outbox
         WHERE sent_at IS NULL
           AND (claimed_at IS NULL OR claimed_at < now() - interval '60 seconds')
         ORDER BY created_at
         LIMIT 50
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, recipients, from_name, subject, body`,
    );
    for (const row of rows) {
      try {
        await sendMail({
          host: config.mail.host,
          port: config.mail.port,
          fromAddress: defaultFrom.address,
          fromName: row.from_name ?? defaultFrom.name,
          to: row.recipients,
          subject: row.subject,
          body: row.body,
        });
        await query(`UPDATE mail_outbox SET sent_at = now() WHERE id = $1`, [row.id]);
      } catch {
        await query(`UPDATE mail_outbox SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
      }
    }
  } finally {
    draining = false;
  }
}
