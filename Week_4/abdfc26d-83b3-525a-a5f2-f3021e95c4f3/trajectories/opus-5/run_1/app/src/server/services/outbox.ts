import { instanceId } from '../config.js';
import { query, transaction, type Queryable } from '../db/pool.js';
import { sendMail } from '../providers/mailer.js';
import { getObject } from '../providers/storage.js';

const RETRY_DELAY_SECONDS = 15;
const CLAIM_BATCH = 10;

export interface QueuedMail {
  readonly recipient: string;
  readonly subject: string;
  readonly bodyText: string;
  readonly attachmentKey: string | null;
  readonly attachmentName: string | null;
  /** Set on a receipt, so its order becomes receipted once mail accepts it. */
  readonly receiptForOrderId?: string;
}

/**
 * Writes an email in the same transaction as the event that causes it, claimed
 * for this instance so the writer makes the first attempt itself.
 */
export async function queueMail(client: Queryable, mail: QueuedMail): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO outbox_messages (recipient, subject, body_text, attachment_key, attachment_name,
                                  receipt_for_order_id, claimed_by, claimed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     RETURNING id`,
    [
      mail.recipient,
      mail.subject,
      mail.bodyText,
      mail.attachmentKey,
      mail.attachmentName,
      mail.receiptForOrderId ?? null,
      instanceId,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error('Outbox insert returned no id');
  return id;
}

interface OutboxRow {
  id: string;
  recipient: string;
  subject: string;
  body_text: string;
  attachment_key: string | null;
  attachment_name: string | null;
  receipt_for_order_id: string | null;
}

/**
 * Claiming a message for sending excludes every other instance. A claim another
 * instance holds is only taken over once it has gone stale, so an instance that
 * died mid-attempt cannot strand a message.
 */
async function claim(limit: number, onlyId: string | null): Promise<OutboxRow[]> {
  const result = await query<OutboxRow>(
    `UPDATE outbox_messages SET claimed_by = $1, claimed_at = now()
     WHERE id IN (
       SELECT id FROM outbox_messages
       WHERE state = 'pending'
         AND next_attempt_at <= now()
         AND ($3::uuid IS NULL OR id = $3)
         AND (claimed_by IS NULL OR claimed_by = $1 OR claimed_at < now() - interval '1 minute')
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     )
     RETURNING id, recipient, subject, body_text, attachment_key, attachment_name,
               receipt_for_order_id`,
    [instanceId, limit, onlyId],
  );
  return result.rows;
}

async function attemptSend(message: OutboxRow): Promise<void> {
  try {
    const attachment =
      message.attachment_key && message.attachment_name
        ? {
            filename: message.attachment_name,
            bytes: await getObject(message.attachment_key),
            contentType: 'application/pdf',
          }
        : null;

    await sendMail({
      to: message.recipient,
      subject: message.subject,
      text: message.body_text,
      attachment,
    });

    await transaction(async (client) => {
      await client.query(
        `UPDATE outbox_messages SET state = 'sent', sent_at = now(), claimed_by = NULL
         WHERE id = $1`,
        [message.id],
      );
      if (message.receipt_for_order_id !== null) {
        await client.query(
          `UPDATE edition_orders SET state = 'receipted', receipt_status = 'sent'
           WHERE id = $1 AND state = 'invoiced'`,
          [message.receipt_for_order_id],
        );
      }
    });
  } catch {
    await query(
      `UPDATE outbox_messages
       SET attempts = attempts + 1,
           next_attempt_at = now() + make_interval(secs => $2),
           claimed_by = NULL
       WHERE id = $1`,
      [message.id, RETRY_DELAY_SECONDS],
    );
  }
}

/** The instance that wrote a message tries to send it at once. */
export async function sendNow(messageId: string): Promise<void> {
  const claimed = await claim(1, messageId);
  for (const message of claimed) {
    await attemptSend(message);
  }
}

/**
 * Scans for due messages. An instance claims them only while its latest mail
 * probe reached mail, so an instance that cannot reach mail never claims one.
 */
export async function drainOutbox(mailReachable: boolean): Promise<void> {
  if (!mailReachable) return;
  const claimed = await claim(CLAIM_BATCH, null);
  for (const message of claimed) {
    await attemptSend(message);
  }
}

/** Queues a message and tries it at once, outside the caller's transaction. */
export async function queueAndSend(mail: QueuedMail): Promise<void> {
  const id = await transaction((client) => queueMail(client, mail));
  await sendNow(id);
}
