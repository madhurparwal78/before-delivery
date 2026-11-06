import type { Queryable } from '../db';
import { newId } from '../domain/ids';
import type { OutboxMessage } from '../services/emails';

/** Writes the email with the change that triggered it; the pump sends it once. */
export async function enqueueEmail(client: Queryable, message: OutboxMessage): Promise<void> {
  await client.query(
    `insert into email_outbox (id, dedupe_key, to_email, subject, body)
     values ($1,$2,$3,$4,$5) on conflict (dedupe_key) do nothing`,
    [newId('eml'), message.dedupeKey, message.to, message.subject, message.body],
  );
}

export async function recordAudit(
  client: Queryable,
  entry: {
    entityType: string;
    entityId: string;
    action: string;
    actorId: string | null;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `insert into audit_log (entity_type, entity_id, action, actor_id, detail)
     values ($1,$2,$3,$4,$5::jsonb)`,
    [
      entry.entityType,
      entry.entityId,
      entry.action,
      entry.actorId,
      JSON.stringify(entry.detail ?? {}),
    ],
  );
}


