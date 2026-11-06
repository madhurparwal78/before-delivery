import { config } from '../config.js';
import { query, tx } from '../db/pool.js';
import { newId } from '../util.js';
import { sendMail } from './smtp.js';

export interface MailDraft {
  readonly serverId: string | null;
  readonly kind: string;
  readonly toHandle: string;
  readonly toEmail: string;
  readonly subject: string;
  readonly lines: readonly string[];
  /** Makes a mail queue exactly once, however many times its cause is retried. */
  readonly dedupeKey: string;
}

/** Every mail is first stored as held, then sent through SMTP. */
export async function queueMail(draft: MailDraft): Promise<string | null> {
  const rows = await query<{ id: string }>(
    `INSERT INTO mail (id, server_id, kind, to_handle, to_email, subject, body, state, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'held', $8)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [
      newId(),
      draft.serverId,
      draft.kind,
      draft.toHandle,
      draft.toEmail,
      draft.subject,
      draft.lines.join('\n'),
      draft.dedupeKey,
    ],
  );
  const row = rows[0];
  return row === undefined ? null : row.id;
}

/** True when the mail is now sent. */
export async function attemptMail(id: string): Promise<boolean> {
  const held = await query<{
    id: string;
    to_email: string;
    subject: string;
    body: string;
  }>(`SELECT id, to_email, subject, body FROM mail WHERE id = $1 AND state = 'held'`, [id]);
  const row = held[0];
  if (row === undefined) return true;
  try {
    await sendMail({ to: row.to_email, subject: row.subject, body: row.body });
  } catch {
    return false;
  }
  await query(`UPDATE mail SET state = 'sent', sent_at = now() WHERE id = $1`, [id]);
  return true;
}

/**
 * Held mail is retried under a row lock, so that each mail is sent exactly once
 * however many instances are running.
 */
export async function flushHeldMail(): Promise<void> {
  const candidates = await query<{ id: string }>(
    `SELECT id FROM mail WHERE state = 'held' ORDER BY created_at LIMIT 25`,
  );
  for (const candidate of candidates) {
    const claimed = await tx(async (client) => {
      const locked = await client.query<{ id: string; to_email: string; subject: string; body: string }>(
        `SELECT id, to_email, subject, body FROM mail
          WHERE id = $1 AND state = 'held'
          FOR UPDATE SKIP LOCKED`,
        [candidate.id],
      );
      return locked.rows[0] ?? null;
    });
    if (claimed === null) continue;
    try {
      await sendMail({ to: claimed.to_email, subject: claimed.subject, body: claimed.body });
    } catch {
      continue;
    }
    await query(`UPDATE mail SET state = 'sent', sent_at = now() WHERE id = $1`, [claimed.id]);
  }
}

/** Links are absolute, built from the public base address. */
export const link = (path: string): string => `${config().publicBaseUrl}${path}`;
