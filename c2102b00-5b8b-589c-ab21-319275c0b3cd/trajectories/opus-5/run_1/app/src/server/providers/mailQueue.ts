import { config, mailEndpoint } from '../config.ts';
import { db, writeTx } from '../db.ts';
import { sendMessage } from './smtp.ts';

export interface MailToQueue {
  kind: 'short' | 'receipt';
  cycleId: string;
  householdCode: string;
  to: string;
  subject: string;
  body: string;
  messageId: string;
}

/** Queues a message against this process's mail endpoint. Called inside the caller's transaction. */
export function queueMail(message: MailToQueue): void {
  db.prepare(
    `INSERT INTO mail_messages (kind, cycle_id, household_code, to_email, subject, body, message_id, endpoint, status, failed_attempts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?)`,
  ).run(
    message.kind,
    message.cycleId,
    message.householdCode,
    message.to,
    message.subject,
    message.body,
    message.messageId,
    mailEndpoint,
    new Date().toISOString().slice(0, 19) + 'Z',
  );
}

interface MailRow {
  id: number;
  to_email: string;
  subject: string;
  body: string;
  message_id: string;
}

let running = false;

async function attemptQueued(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const staleBefore = Date.now() - 60_000;
    const rows = db
      .prepare(
        `SELECT id, to_email, subject, body, message_id FROM mail_messages
         WHERE status = 'queued' AND endpoint = ? AND (claimed_at IS NULL OR claimed_at < ?)
         ORDER BY id`,
      )
      .all(mailEndpoint, staleBefore) as MailRow[];
    for (const row of rows) {
      const claimed = writeTx(() => {
        const info = db
          .prepare(
            `UPDATE mail_messages SET claimed_at = ?
             WHERE id = ? AND status = 'queued' AND (claimed_at IS NULL OR claimed_at < ?)`,
          )
          .run(Date.now(), row.id, staleBefore);
        return info.changes === 1;
      });
      if (!claimed) continue;
      try {
        await sendMessage({
          to: row.to_email,
          subject: row.subject,
          body: row.body,
          messageId: row.message_id,
        });
        writeTx(() => {
          db.prepare("UPDATE mail_messages SET status = 'sent', claimed_at = NULL WHERE id = ?").run(row.id);
        });
      } catch {
        writeTx(() => {
          db.prepare(
            'UPDATE mail_messages SET failed_attempts = failed_attempts + 1, claimed_at = NULL WHERE id = ?',
          ).run(row.id);
        });
      }
    }
  } finally {
    running = false;
  }
}

/** Tries this process's queued messages right after the caller's transaction commits. */
export function deliverQueuedSoon(): void {
  setTimeout(() => {
    void attemptQueued();
  }, 0);
}

export function startMailRetries(): void {
  setInterval(() => {
    void attemptQueued();
  }, config.mailRetrySeconds * 1000).unref();
}
