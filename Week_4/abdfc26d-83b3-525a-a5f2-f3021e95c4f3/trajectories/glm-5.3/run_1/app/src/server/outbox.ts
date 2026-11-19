import { transaction, query, type Tx } from './db.js';
import { smtpSend, mailProbe, type MailMessage } from './lib/mail.js';

export type OutboxKind = 'receipt' | 'render_ready' | 'refund_notice' | 'statement';

export async function queueMail(tx: Tx, kind: OutboxKind, message: MailMessage): Promise<void> {
  await tx.query(
    `INSERT INTO outbox (kind, payload, state, available_at) VALUES ($1, $2::jsonb, 'waiting', now())`,
    [kind, JSON.stringify(message)]
  );
}

/** Sends due messages; only an instance whose latest mail probe reached mail claims. */
export async function flushOutbox(): Promise<void> {
  const mailUp = await mailProbe();
  if (!mailUp) return;
  const due = await query<{ id: string; kind: OutboxKind; payload: string }>(
    `SELECT id, kind, payload::text AS payload FROM outbox
     WHERE state = 'waiting' AND available_at <= now()
     ORDER BY id LIMIT 10`
  );
  for (const row of due) {
    const message = JSON.parse(row.payload) as MailMessage;
    try {
      await smtpSend(message);
      await markSent(row.id, message, row.kind);
    } catch {
      await query(
        `UPDATE outbox SET attempts = attempts + 1, available_at = now() + interval '15 seconds' WHERE id = $1`,
        [row.id]
      );
    }
  }
}

/** Marking a receipt sent moves its order from invoiced to receipted. */
async function markSent(outboxId: string, message: MailMessage, kind: OutboxKind): Promise<void> {
  await transaction(async (tx) => {
    await tx.query(`UPDATE outbox SET state = 'sent', sent_at = now(), attempts = attempts + 1 WHERE id = $1`, [outboxId]);
    if (kind !== 'receipt') return;
    const order = await tx.one<{ id: string }>(`SELECT id FROM orders WHERE email = $1 AND state = 'invoiced' AND receipt_status = 'queued' ORDER BY paid_at DESC LIMIT 1`, [message.to]);
    if (!order) return;
    await tx.query(
      `UPDATE orders SET receipt_status = 'sent', state = 'receipted' WHERE id = $1 AND state = 'invoiced'`,
      [order.id]
    );
  });
}

/** Used by tests/ops: how many messages are waiting. */
export async function outboxWaiting(): Promise<number> {
  const row = await query<{ count: string }>(`SELECT count(*)::text AS count FROM outbox WHERE state = 'waiting'`);
  return Number(row[0]?.count ?? 0);
}
