import { query, type Queryable } from '../db/pool.js';
import { newId } from '../util/ids.js';

export type EmailKind =
  | 'enrolment_receipt'
  | 'seat_invitation'
  | 'certificate_issued'
  | 'certificate_reissued';

export interface QueuedEmail {
  readonly kind: EmailKind;
  readonly dedupeKey: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

/**
 * The outbox is written in the same transaction as the event it reports, and the dedupe
 * key makes each event send exactly one message however often it is retried.
 */
export async function queueEmail(client: Queryable, email: QueuedEmail): Promise<void> {
  await client.query(
    `INSERT INTO email_outbox (id, kind, dedupe_key, to_email, subject, body)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (dedupe_key) DO NOTHING`,
    [newId(), email.kind, email.dedupeKey, email.to, email.subject, email.body],
  );
}

export interface OutboxRow {
  readonly id: string;
  readonly to_email: string;
  readonly subject: string;
  readonly body: string;
}

export async function takeUnsent(client: Queryable, limit: number): Promise<OutboxRow[]> {
  return query<OutboxRow>(
    client,
    `SELECT id, to_email, subject, body FROM email_outbox
     WHERE sent_at IS NULL ORDER BY created_at LIMIT $1`,
    [limit],
  );
}

export async function markSent(client: Queryable, id: string): Promise<void> {
  await client.query('UPDATE email_outbox SET sent_at = now() WHERE id = $1', [id]);
}

export async function markAttempt(client: Queryable, id: string): Promise<void> {
  await client.query('UPDATE email_outbox SET attempts = attempts + 1 WHERE id = $1', [id]);
}
