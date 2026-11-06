import type { PoolClient } from '../db';
import { rows } from '../db';
import { randomId } from '../crypto/seal';
import { isoSecond } from '../format';
import { nowSecond } from '../http/core';

export type EventType = 'object.created' | 'object.deleted' | 'object.restored' | 'version.removed';

export interface EventInput {
  workspaceSlug: string;
  type: EventType;
  bucket: string;
  key: string;
  versionId: string;
  etag: string;
  size: number;
  reason?: 'lifecycle' | 'request';
}

/**
 * Records one event and queues one delivery per active endpoint that subscribes to it, in the same
 * change. Delivery sequences are gapless and ascending per endpoint in event order.
 */
export async function emitEvent(client: PoolClient, input: EventInput): Promise<void> {
  const id = randomId('evt');
  const occurredAt = nowSecond();
  await client.query(
    `insert into events (id, workspace_slug, event_type, bucket, object_key, version_id, etag, size, reason, occurred_at, fanned_out)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)`,
    [
      id,
      input.workspaceSlug,
      input.type,
      input.bucket,
      input.key,
      input.versionId,
      input.etag,
      input.size,
      input.reason ?? null,
      occurredAt.toISOString(),
    ],
  );
  const endpoints = await rows<{ id: string; next_sequence: string; events: string[]; buckets: string[] | null }>(
    client,
    `select id, next_sequence::text as next_sequence, events, buckets from webhook_endpoints
     where workspace_slug = $1 and state = 'active' order by created_at for update`,
    [input.workspaceSlug],
  );
  for (const endpoint of endpoints) {
    if (!endpoint.events.includes(input.type)) continue;
    if (endpoint.buckets !== null && !endpoint.buckets.includes(input.bucket)) continue;
    const sequence = Number(endpoint.next_sequence);
    const body: Record<string, unknown> = {
      id,
      type: input.type,
      sequence,
      occurred_at: isoSecond(occurredAt),
      bucket: input.bucket,
      key: input.key,
      version_id: input.versionId,
      etag: input.etag,
      size: input.size,
    };
    if (input.type === 'version.removed') body.reason = input.reason ?? 'request';
    await client.query(
      `insert into deliveries (id, endpoint_id, event_id, event_type, sequence, state, attempts, next_attempt_at, body, created_at)
       values ($1, $2, $3, $4, $5, 'pending', 0, now(), $6, now())`,
      [randomId('dlv'), endpoint.id, id, input.type, sequence, JSON.stringify(body)],
    );
    await client.query('update webhook_endpoints set next_sequence = next_sequence + 1 where id = $1', [endpoint.id]);
  }
}
