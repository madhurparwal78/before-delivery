import { pool } from '../db';
import { env } from '../env';
import { sendMail } from './smtp';
import { deleteObject, listObjectKeys, putObject } from './storage';

const CLAIM_TIMEOUT_SECONDS = 60;

/**
 * Pending work lives in the shared database, so whichever instance can reach a
 * service picks it up. Each row is claimed before an attempt and released after
 * a failure.
 */
async function claimPendingAttachment(): Promise<{
  id: string;
  object_key: string;
  content_type: string;
  pending_bytes: Buffer;
} | null> {
  const { rows } = await pool.query<{
    id: string;
    object_key: string;
    content_type: string;
    pending_bytes: Buffer;
  }>(
    `UPDATE attachments SET claimed_at = now()
      WHERE id = (
        SELECT id FROM attachments
         WHERE status = 'pending'
           AND (claimed_at IS NULL OR claimed_at < now() - make_interval(secs => $1))
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING id, object_key, content_type, pending_bytes`,
    [CLAIM_TIMEOUT_SECONDS],
  );
  return rows[0] ?? null;
}

async function drainPendingAttachments(): Promise<void> {
  for (;;) {
    const attachment = await claimPendingAttachment();
    if (!attachment) return;
    try {
      await putObject(attachment.object_key, attachment.pending_bytes, attachment.content_type);
      await pool.query(
        `UPDATE attachments SET status = 'available', pending_bytes = NULL, claimed_at = NULL
          WHERE id = $1`,
        [attachment.id],
      );
    } catch {
      await pool.query('UPDATE attachments SET claimed_at = NULL WHERE id = $1', [attachment.id]);
      return;
    }
  }
}

async function claimPendingDeletion(): Promise<{ id: string; prefix: string } | null> {
  const { rows } = await pool.query<{ id: string; prefix: string }>(
    `UPDATE pending_object_deletions SET claimed_at = now()
      WHERE id = (
        SELECT id FROM pending_object_deletions
         WHERE done_at IS NULL
           AND (claimed_at IS NULL OR claimed_at < now() - make_interval(secs => $1))
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING id, prefix`,
    [CLAIM_TIMEOUT_SECONDS],
  );
  return rows[0] ?? null;
}

async function drainPendingDeletions(): Promise<void> {
  for (;;) {
    const record = await claimPendingDeletion();
    if (!record) return;
    try {
      for (const key of await listObjectKeys(record.prefix)) await deleteObject(key);
      const remaining = await listObjectKeys(record.prefix);
      if (remaining.length > 0) throw new Error('objects remain under the prefix');
      await pool.query('UPDATE pending_object_deletions SET done_at = now(), claimed_at = NULL WHERE id = $1', [
        record.id,
      ]);
    } catch {
      await pool.query('UPDATE pending_object_deletions SET claimed_at = NULL WHERE id = $1', [record.id]);
      return;
    }
  }
}

async function claimOutboxRow(): Promise<{
  id: string;
  recipient_name: string;
  recipient_email: string;
  subject: string;
  text_body: string;
  html_body: string;
} | null> {
  const { rows } = await pool.query<{
    id: string;
    recipient_name: string;
    recipient_email: string;
    subject: string;
    text_body: string;
    html_body: string;
  }>(
    `UPDATE outbox SET claimed_at = now()
      WHERE id = (
        SELECT id FROM outbox
         WHERE sent_at IS NULL
           AND (claimed_at IS NULL OR claimed_at < now() - make_interval(secs => $1))
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING id, recipient_name, recipient_email, subject, text_body, html_body`,
    [CLAIM_TIMEOUT_SECONDS],
  );
  return rows[0] ?? null;
}

async function drainOutbox(): Promise<void> {
  for (;;) {
    const row = await claimOutboxRow();
    if (!row) return;
    try {
      await sendMail({
        to: row.recipient_email,
        toName: row.recipient_name,
        subject: row.subject,
        textBody: row.text_body,
        htmlBody: row.html_body,
      });
      await pool.query('UPDATE outbox SET sent_at = now(), claimed_at = NULL WHERE id = $1', [row.id]);
    } catch {
      await pool.query('UPDATE outbox SET claimed_at = NULL WHERE id = $1', [row.id]);
      return;
    }
  }
}

function repeat(task: () => Promise<void>, seconds: number): void {
  const run = (): void => {
    task()
      .catch(() => undefined)
      .finally(() => {
        const timer = setTimeout(run, seconds * 1000);
        timer.unref();
      });
  };
  run();
}

export function startWorkers(): void {
  repeat(drainPendingAttachments, env.attachmentRetrySeconds);
  repeat(drainPendingDeletions, env.attachmentRetrySeconds);
  repeat(drainOutbox, env.outboxRetrySeconds);
}
