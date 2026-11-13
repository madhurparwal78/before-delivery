import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { pool, withTransaction } from '../db/pool.ts';
import { appendAudit } from '../domain/audit.ts';
import { MailUnavailable, headerSafe, parseAddress, sendMail } from '../services/mail.ts';
import { health, markMailDown, recheckMail } from '../services/health.ts';
import { touchDocument } from './document.ts';

export type MailKind = 'invitation' | 'reminder' | 'new_link' | 'decline' | 'void' | 'completed';

/** Link emails carry this marker so a retry rebuilds the link from its own public address. */
const BASE_MARKER = '%APP_PUBLIC_URL%';

export interface Outgoing {
  kind: MailKind;
  documentId: string;
  /** Set for invitation and new-link emails, whose delivery the row tracks. */
  recipientId: string | null;
  to: string;
  from: string;
  subject: string;
  body: string;
}

const LINK_KINDS: readonly MailKind[] = ['invitation', 'new_link'];

const senderFrom = (senderName: string): string =>
  `${headerSafe(senderName)} via Undersign <${parseAddress(config.mailFrom).email}>`;

export const invitationMail = (
  documentId: string,
  recipientId: string,
  to: string,
  title: string,
  senderName: string,
  token: string,
): Outgoing => ({
  kind: 'invitation',
  documentId,
  recipientId,
  to,
  from: senderFrom(senderName),
  subject: `Please sign: ${headerSafe(title)}`,
  body: `Open the document: ${BASE_MARKER}/sign/${token}\n`,
});

export const reminderMail = (
  documentId: string,
  recipientId: string,
  to: string,
  title: string,
  senderName: string,
  token: string,
): Outgoing => ({
  kind: 'reminder',
  documentId,
  recipientId: null,
  to,
  from: senderFrom(senderName),
  subject: `Reminder: please sign ${headerSafe(title)}`,
  body: `Open the document: ${BASE_MARKER}/sign/${token}\n`,
});

export const newLinkMail = (
  documentId: string,
  recipientId: string,
  to: string,
  title: string,
  senderName: string,
  token: string,
): Outgoing => ({
  kind: 'new_link',
  documentId,
  recipientId,
  to,
  from: senderFrom(senderName),
  subject: `New link: ${headerSafe(title)}`,
  body: `Open the document: ${BASE_MARKER}/sign/${token}\n`,
});

export const declineMail = (
  documentId: string,
  to: string,
  title: string,
  reason: string,
): Outgoing => ({
  kind: 'decline',
  documentId,
  recipientId: null,
  to,
  from: config.mailFrom,
  subject: `Declined: ${headerSafe(title)}`,
  body: `Reason: ${reason}\n`,
});

export const voidMail = (
  documentId: string,
  to: string,
  title: string,
  reason: string,
): Outgoing => ({
  kind: 'void',
  documentId,
  recipientId: null,
  to,
  from: config.mailFrom,
  subject: `Voided: ${headerSafe(title)}`,
  body: `Reason: ${reason}\n`,
});

export const completedMail = (
  documentId: string,
  to: string,
  title: string,
  completedSha256: string,
  downloadPath: string,
): Outgoing => ({
  kind: 'completed',
  documentId,
  recipientId: null,
  to,
  from: config.mailFrom,
  subject: `Completed: ${headerSafe(title)}`,
  body: `SHA-256 of the completed PDF: ${completedSha256}\nDownload: ${BASE_MARKER}${downloadPath}\n`,
});

const transmit = async (outgoing: Outgoing): Promise<void> => {
  await sendMail({
    from: outgoing.from,
    to: outgoing.to,
    subject: outgoing.subject,
    body: outgoing.body.split(BASE_MARKER).join(config.appPublicUrl),
  });
};

const markSent = async (outgoing: Outgoing): Promise<void> => {
  if (outgoing.recipientId === null) return;
  await withTransaction(async (client) => {
    await client.query("UPDATE recipients SET delivery = 'sent' WHERE id = $1", [
      outgoing.recipientId,
    ]);
    await appendAudit(client, {
      documentId: outgoing.documentId,
      type: 'invite.sent',
      actor: 'system',
      recipientId: outgoing.recipientId,
    });
    await touchDocument(client, outgoing.documentId);
  });
};

const hold = async (outgoing: Outgoing): Promise<void> => {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO mail_outbox (id, document_id, recipient_id, kind, to_email, from_header,
                                subject, body, state, held_at, last_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'held', now(), now())`,
      [
        randomUUID(),
        outgoing.documentId,
        outgoing.recipientId,
        outgoing.kind,
        outgoing.to,
        outgoing.from,
        outgoing.subject,
        outgoing.body,
      ],
    );
    if (outgoing.recipientId !== null) {
      await client.query("UPDATE recipients SET delivery = 'held' WHERE id = $1", [
        outgoing.recipientId,
      ]);
      await appendAudit(client, {
        documentId: outgoing.documentId,
        type: 'invite.held',
        actor: 'system',
        recipientId: outgoing.recipientId,
      });
      await touchDocument(client, outgoing.documentId);
    }
  });
};

/** Sends now, or holds for a later retry when this instance's email is down. */
export const deliverOrHold = async (outgoing: Outgoing): Promise<void> => {
  if (!health().mail) {
    await hold(outgoing);
    return;
  }
  try {
    await transmit(outgoing);
  } catch (error) {
    if (error instanceof MailUnavailable) {
      markMailDown();
      void recheckMail();
      await hold(outgoing);
      return;
    }
    throw error;
  }
  await markSent(outgoing);
};

/** Reminders are never held: a failure is reported to the sender. */
export const deliverNow = async (outgoing: Outgoing): Promise<void> => {
  if (!health().mail) throw new MailUnavailable('email is down');
  try {
    await transmit(outgoing);
  } catch (error) {
    markMailDown();
    void recheckMail();
    throw error;
  }
};

export const deliverAllOrHold = async (messages: readonly Outgoing[]): Promise<void> => {
  for (const message of messages) {
    await deliverOrHold(message);
  }
};

interface OutboxRow {
  id: string;
  document_id: string;
  recipient_id: string | null;
  kind: MailKind;
  to_email: string;
  from_header: string;
  subject: string;
  body: string;
}

/**
 * Retries held email. Only an instance whose email and storage both pass its
 * latest health check takes part, and the row lock keeps delivery to once.
 */
export const retryHeldEmails = async (): Promise<void> => {
  const current = health();
  if (!current.mail || !current.storage) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const due = await client.query<OutboxRow>(
      `SELECT id, document_id, recipient_id, kind, to_email, from_header, subject, body
       FROM mail_outbox
       WHERE state = 'held' AND last_attempt_at <= now() - ($1 || ' seconds')::interval
       ORDER BY held_at
       FOR UPDATE SKIP LOCKED
       LIMIT 5`,
      [String(config.mailRetrySeconds)],
    );
    for (const row of due.rows) {
      const outgoing: Outgoing = {
        kind: row.kind,
        documentId: row.document_id,
        recipientId: row.recipient_id,
        to: row.to_email,
        from: row.from_header,
        subject: row.subject,
        body: row.body,
      };
      try {
        await transmit(outgoing);
      } catch (error) {
        if (!(error instanceof MailUnavailable)) throw error;
        markMailDown();
        void recheckMail();
        await client.query('UPDATE mail_outbox SET last_attempt_at = now() WHERE id = $1', [
          row.id,
        ]);
        continue;
      }
      await client.query(
        "UPDATE mail_outbox SET state = 'sent', delivered_at = now() WHERE id = $1",
        [row.id],
      );
      if (row.recipient_id !== null && LINK_KINDS.includes(row.kind)) {
        await client.query("UPDATE recipients SET delivery = 'sent' WHERE id = $1", [
          row.recipient_id,
        ]);
        await appendAudit(client, {
          documentId: row.document_id,
          type: 'invite.sent',
          actor: 'system',
          recipientId: row.recipient_id,
        });
        await touchDocument(client, row.document_id);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    process.stderr.write(`held email retry failed: ${String(error)}\n`);
  } finally {
    client.release();
  }
};

