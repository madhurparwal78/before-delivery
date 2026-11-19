import type { PoolClient } from 'pg';

export type OutgoingKind = 'email' | 'webhook';

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface WebhookMessage {
  venue_slug: string;
  member_id: string;
  event_type: string;
  event_id: string;
  payload: Record<string, unknown>;
}

/**
 * Queued in the same transaction as the change that causes it, so any instance that can reach the
 * provider delivers it exactly once.
 */
export async function enqueue(
  client: PoolClient,
  kind: OutgoingKind,
  dedupeKey: string,
  payload: EmailMessage | WebhookMessage,
): Promise<void> {
  await client.query(
    `insert into outgoing_messages (kind, dedupe_key, payload) values ($1,$2,$3)
     on conflict (dedupe_key) do nothing`,
    [kind, dedupeKey, payload],
  );
}
