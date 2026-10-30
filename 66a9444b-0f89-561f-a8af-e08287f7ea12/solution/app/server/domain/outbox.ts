// Mail is written to the outbox in the same commit as the change that caused it. Any instance delivers it:
// a row is claimed with FOR UPDATE SKIP LOCKED for the whole SMTP exchange and marked sent the moment SMTP
// accepts it, so no two instances ever attempt the same message. The Message-ID is fixed by the row id.
import type { Db } from "../db/index.ts";
import { transaction } from "../db/index.ts";
import { deliver, type MailAttachment } from "../services/smtp.ts";

export type Mail = { to: string; subject: string; body: string; attachments?: MailAttachment[] };

const messageId = (outboxId: number) => `<kerf-${outboxId}@kerf.example>`;

export async function queueMail(q: Db, mail: Mail): Promise<number> {
  const row = await q.one<{ id: number }>(
    "INSERT INTO outbox (to_address, subject, body, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
    [mail.to, mail.subject, mail.body, new Date()]);
  for (const [position, attachment] of (mail.attachments ?? []).entries()) {
    await q.query("INSERT INTO outbox_attachments (outbox_id, position, filename, content) VALUES ($1, $2, $3, $4)",
      [row!.id, position, attachment.filename, attachment.content]);
  }
  return row!.id;
}

/** Delivers queued mail until the outbox is empty or SMTP stops answering. */
export async function deliverOutbox(): Promise<void> {
  for (;;) {
    const sent = await transaction(async (tx) => {
      const next = await tx.one<{ id: number; to_address: string; subject: string; body: string }>(
        "SELECT id, to_address, subject, body FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED");
      if (!next) return false;
      const attachments = await tx.all<{ filename: string; content: Buffer }>(
        "SELECT filename, content FROM outbox_attachments WHERE outbox_id = $1 ORDER BY position", [next.id]);
      await deliver({ messageId: messageId(next.id), to: next.to_address, subject: next.subject, body: next.body, attachments });
      await tx.query("UPDATE outbox SET sent_at = $2, attempts = attempts + 1 WHERE id = $1", [next.id, new Date()]);
      return true;
    });
    if (!sent) return;
  }
}
