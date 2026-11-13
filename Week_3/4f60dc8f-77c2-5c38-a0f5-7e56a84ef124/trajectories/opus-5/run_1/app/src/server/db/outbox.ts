import { randomUUID } from 'node:crypto';
import { query, type Queryable } from './pool.js';

export type OutboxKind =
  | 'deposit_receipt_email'
  | 'invoice_issued_email'
  | 'invoice_receipt_email'
  | 'payment_failed_email'
  | 'overdue_email'
  | 'review_link_email'
  | 'refund_email'
  | 'signin_code_email'
  | 'push';

export type OutboxRow = {
  id: string;
  kind: OutboxKind;
  payload: Record<string, unknown>;
  attempts: number;
};

/** Written in the same transaction as its cause, so an undone cause leaves no message. */
export const enqueue = async (
  client: Queryable,
  kind: OutboxKind,
  payload: Record<string, unknown>,
  dedupeKey: string,
): Promise<void> => {
  await client.query(
    `INSERT INTO outbox (id, kind, payload, dedupe_key) VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [randomUUID(), kind, JSON.stringify(payload), dedupeKey],
  );
};

export const claimOutboxBatch = async (): Promise<OutboxRow[]> =>
  (
    await query<OutboxRow>(
      `UPDATE outbox SET state = 'sending', locked_until = now() + interval '60 seconds'
       WHERE id IN (
         SELECT id FROM outbox
         WHERE state = 'pending' OR (state = 'sending' AND locked_until < now())
         ORDER BY created_at
         LIMIT 10
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, kind, payload, attempts`,
    )
  ).rows;

export const markOutboxSent = async (id: string): Promise<void> => {
  await query("UPDATE outbox SET state = 'sent', sent_at = now(), locked_until = NULL WHERE id = $1", [
    id,
  ]);
};

export const releaseOutbox = async (id: string): Promise<void> => {
  await query(
    "UPDATE outbox SET state = 'pending', attempts = attempts + 1, locked_until = NULL WHERE id = $1",
    [id],
  );
};
