import { newId } from '../crypto';
import { query, type PoolClient } from '../db';
import type { OutboundMessage } from './mail';
import { sendMail } from './mail';

export type MessageKind = 'invitation' | 'access_changed';

export interface QueuedMessage {
  diagramId: string;
  shareId: string | null;
  kind: MessageKind;
  message: OutboundMessage;
}

/** Every message is stored in the same transaction as its share transition. */
export async function enqueueMessage(client: PoolClient, queued: QueuedMessage): Promise<void> {
  await client.query(
    `insert into mail_queue (id, diagram_id, share_id, kind, to_email, subject, body)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      newId(),
      queued.diagramId,
      queued.shareId,
      queued.kind,
      queued.message.to,
      queued.message.subject,
      queued.message.body,
    ],
  );
  if (queued.kind === 'invitation' && queued.shareId) {
    await client.query(`update shares set delivery = 'queued' where id = $1`, [queued.shareId]);
  }
}

interface ClaimRow {
  id: string;
  share_id: string | null;
  kind: MessageKind;
  to_email: string;
  subject: string;
  body: string;
}

/**
 * Each queued message is claimed by one instance at a time and marked sent only
 * after the mail server accepts it, so it is delivered exactly once.
 */
export async function deliverQueuedMessages(): Promise<void> {
  const claimed = await query<ClaimRow>(
    `update mail_queue set claimed_until = now() + interval '30 seconds'
     where id in (
       select id from mail_queue
       where status = 'pending' and (claimed_until is null or claimed_until < now())
       order by created_at
       limit 10
       for update skip locked
     )
     returning id, share_id, kind, to_email, subject, body`,
  );
  for (const row of claimed) {
    try {
      await sendMail({ to: row.to_email, subject: row.subject, body: row.body });
      await query(`update mail_queue set status = 'sent', sent_at = now(), claimed_until = null where id = $1`, [row.id]);
      if (row.kind === 'invitation' && row.share_id) {
        await query(`update shares set delivery = 'sent' where id = $1`, [row.share_id]);
      }
    } catch {
      await query('update mail_queue set claimed_until = null where id = $1', [row.id]);
    }
  }
}

export function startQueueWorker(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void deliverQueuedMessages().catch(() => undefined);
  }, 5000);
  timer.unref();
  return timer;
}
