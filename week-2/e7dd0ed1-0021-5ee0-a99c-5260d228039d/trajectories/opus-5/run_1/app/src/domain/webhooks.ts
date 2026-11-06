import * as crypto from 'node:crypto';
import type { PoolClient } from '../db';
import { query, row } from '../db';
import { apiError } from '../errors';
import { isoSecond } from '../format';
import { randomId, seal } from '../crypto/seal';
import { nowSecond } from '../http/core';
import { countCharacters } from './text';
import type { EventType } from './events';

export interface EndpointRecord {
  id: string;
  workspace_slug: string;
  url: string;
  events: string[];
  buckets: string[] | null;
  description: string;
  state: string;
  secret_sealed: string;
  created_at: string;
}

const columns = 'id, workspace_slug, url, events, buckets, description, state, secret_sealed, created_at';

export const endpointMessages = {
  url: 'Enter an http or https URL without credentials.',
  events: 'Choose one or more event types.',
  buckets: 'Choose buckets from this workspace, or all buckets.',
  description: 'Descriptions are limited to 140 characters.',
};

export const eventTypes: EventType[] = ['object.created', 'object.deleted', 'object.restored', 'version.removed'];

export function newSigningSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('base64url').slice(0, 43)}`;
}

export function endpointJson(endpoint: EndpointRecord): Record<string, unknown> {
  return {
    id: endpoint.id,
    url: endpoint.url,
    events: endpoint.events,
    buckets: endpoint.buckets,
    description: endpoint.description,
    state: endpoint.state,
    created_at: isoSecond(endpoint.created_at),
  };
}

export interface EndpointInput {
  url: string;
  events: string[];
  buckets: string[] | null;
  description: string;
}

export function validateEndpoint(body: Record<string, unknown>, workspaceBuckets: string[]): EndpointInput {
  const failures: Record<string, string> = {};
  let url = '';
  if (typeof body.url !== 'string' || Buffer.byteLength(body.url, 'utf8') > 2048) failures.url = endpointMessages.url;
  else {
    try {
      const parsed = new URL(body.url);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username !== '' || parsed.password !== '' || parsed.hash !== '') {
        failures.url = endpointMessages.url;
      } else url = body.url;
    } catch {
      failures.url = endpointMessages.url;
    }
  }
  let events: string[] = [];
  if (
    Array.isArray(body.events) &&
    body.events.length >= 1 &&
    body.events.length <= 4 &&
    new Set(body.events).size === body.events.length &&
    body.events.every((item) => typeof item === 'string' && (eventTypes as string[]).includes(item))
  ) {
    events = body.events as string[];
  } else failures.events = endpointMessages.events;
  let buckets: string[] | null = null;
  if (body.buckets === undefined || body.buckets === null) buckets = null;
  else if (
    Array.isArray(body.buckets) &&
    body.buckets.length > 0 &&
    body.buckets.every((name) => typeof name === 'string' && workspaceBuckets.includes(name))
  ) {
    buckets = body.buckets as string[];
  } else failures.buckets = endpointMessages.buckets;
  const description = body.description === undefined || body.description === null ? '' : body.description;
  if (typeof description !== 'string' || countCharacters(description) > 140) failures.description = endpointMessages.description;
  if (Object.keys(failures).length > 0) throw apiError('validation_failed', 'Some fields need fixing.', { errors: failures });
  return { url, events, buckets, description: description as string };
}

export async function listEndpoints(slug: string): Promise<EndpointRecord[]> {
  return query<EndpointRecord>(`select ${columns} from webhook_endpoints where workspace_slug = $1 order by created_at`, [slug]);
}

export async function createEndpoint(
  client: PoolClient,
  slug: string,
  input: EndpointInput,
): Promise<{ endpoint: EndpointRecord; secret: string }> {
  const existing = await row<{ count: string }>(
    client,
    'select count(*)::text as count from webhook_endpoints where workspace_slug = $1',
    [slug],
  );
  if (Number(existing?.count ?? '0') >= 5) throw apiError('endpoint_limit');
  const secret = newSigningSecret();
  const created = await row<EndpointRecord>(
    client,
    `insert into webhook_endpoints (id, workspace_slug, url, events, buckets, description, state, secret_sealed, created_at)
     values ($1, $2, $3, $4, $5, $6, 'active', $7, $8) returning ${columns}`,
    [randomId('whk'), slug, input.url, input.events, input.buckets, input.description, seal(secret), nowSecond().toISOString()],
  );
  return { endpoint: created as EndpointRecord, secret };
}

export async function findEndpoint(client: PoolClient, slug: string, id: string): Promise<EndpointRecord | null> {
  return row<EndpointRecord>(client, `select ${columns} from webhook_endpoints where id = $1 and workspace_slug = $2 for update`, [id, slug]);
}

export async function setEndpointState(
  client: PoolClient,
  endpoint: EndpointRecord,
  next: 'active' | 'disabled',
): Promise<EndpointRecord> {
  if (endpoint.state === next) {
    throw apiError('invalid_transition', "That change isn't allowed from the current state.", { from: endpoint.state, to: next });
  }
  const updated = await row<EndpointRecord>(
    client,
    `update webhook_endpoints set state = $2 where id = $1 returning ${columns}`,
    [endpoint.id, next],
  );
  return updated as EndpointRecord;
}

export async function deleteEndpoint(client: PoolClient, endpoint: EndpointRecord): Promise<void> {
  if (endpoint.state !== 'disabled') {
    throw apiError('invalid_transition', "That change isn't allowed from the current state.", {
      from: endpoint.state,
      to: 'deleted',
    });
  }
  await client.query('delete from webhook_endpoints where id = $1', [endpoint.id]);
}

export interface DeliveryRecord {
  id: string;
  endpoint_id: string;
  event_id: string;
  event_type: string;
  sequence: string;
  state: string;
  attempts: number;
  last_status: number | null;
  last_error: string | null;
  next_attempt_at: string | null;
  delivered_at: string | null;
  body: string;
}

export function deliveryJson(delivery: DeliveryRecord): Record<string, unknown> {
  return {
    id: delivery.id,
    event_id: delivery.event_id,
    event_type: delivery.event_type,
    sequence: Number(delivery.sequence),
    state: delivery.state,
    attempts: delivery.attempts,
    last_status: delivery.last_status === null ? null : Number(delivery.last_status),
    last_error: delivery.last_error,
    next_attempt_at: delivery.next_attempt_at ? isoSecond(delivery.next_attempt_at) : null,
    delivered_at: delivery.delivered_at ? isoSecond(delivery.delivered_at) : null,
  };
}

export async function listDeliveries(endpointId: string, offset: number): Promise<DeliveryRecord[]> {
  return query<DeliveryRecord>(
    `select id, endpoint_id, event_id, event_type, sequence::text as sequence, state, attempts, last_status, last_error,
            next_attempt_at, delivered_at, body
     from deliveries where endpoint_id = $1 order by sequence desc offset $2 limit 51`,
    [endpointId, offset],
  );
}

export async function redeliver(client: PoolClient, endpointId: string, deliveryId: string): Promise<DeliveryRecord> {
  const delivery = await row<DeliveryRecord>(
    client,
    `select id, endpoint_id, event_id, event_type, sequence::text as sequence, state, attempts, last_status, last_error,
            next_attempt_at, delivered_at, body
     from deliveries where id = $1 and endpoint_id = $2 for update`,
    [deliveryId, endpointId],
  );
  if (!delivery) throw apiError('not_found');
  if (delivery.state !== 'dead') {
    throw apiError('invalid_transition', "That change isn't allowed from the current state.", {
      from: delivery.state,
      to: 'pending',
    });
  }
  const updated = await row<DeliveryRecord>(
    client,
    `update deliveries set state = 'pending', attempts = 0, next_attempt_at = now(), last_error = null, last_status = null
     where id = $1
     returning id, endpoint_id, event_id, event_type, sequence::text as sequence, state, attempts, last_status, last_error,
               next_attempt_at, delivered_at, body`,
    [deliveryId],
  );
  return updated as DeliveryRecord;
}

/** The one webhook signature: hex HMAC-SHA256 of `<t>.<raw body>` keyed by the whole secret string. */
export function signBody(secret: string, timestampSeconds: number, rawBody: string): string {
  return crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(`${timestampSeconds}.${rawBody}`, 'utf8').digest('hex');
}
