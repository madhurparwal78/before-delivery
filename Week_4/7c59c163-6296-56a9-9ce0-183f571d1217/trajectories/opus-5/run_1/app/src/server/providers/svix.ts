import { config } from '../config.js';
import { ProviderRefused, providerFetch, providerJson, reachable } from './http.js';

const PROVIDER = 'svix';
const base = `${config.svix.url}/api/v1`;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${config.svix.apiKey}`, accept: 'application/json', ...extra };
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  return providerJson<T>(PROVIDER, `${base}${path}`, {
    method,
    headers: headers(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export const applicationUid = (venueSlug: string): string => `venue-${venueSlug}`;
export const endpointUid = (memberId: string): string => `member-${memberId}`;
export const memberChannel = (memberId: string): string => `member-${memberId}`;

interface Application {
  id: string;
  uid: string;
}

export async function ensureApplication(venueSlug: string): Promise<string> {
  const uid = applicationUid(venueSlug);
  const existing = await providerFetch(PROVIDER, `${base}/app/${uid}`, { headers: headers() });
  if (existing.status === 200) return (JSON.parse(existing.text) as Application).id;
  if (existing.status !== 404) throw new ProviderRefused(PROVIDER, existing.status, existing.text);
  const created = await send<Application>('POST', '/app', { name: `Plumtide ${venueSlug}`, uid });
  return created.id;
}

export interface Endpoint {
  id: string;
  url: string;
  signingSecret: string;
}

interface SvixEndpoint {
  id: string;
  url: string;
  uid?: string;
}

export async function upsertEndpoint(
  venueSlug: string,
  memberId: string,
  url: string,
): Promise<Endpoint> {
  const appUid = applicationUid(venueSlug);
  await ensureApplication(venueSlug);
  const uid = endpointUid(memberId);
  const existing = await providerFetch(PROVIDER, `${base}/app/${appUid}/endpoint/${uid}`, {
    headers: headers(),
  });
  let endpoint: SvixEndpoint;
  if (existing.status === 200) {
    endpoint = await send<SvixEndpoint>('PUT', `/app/${appUid}/endpoint/${uid}`, {
      url,
      uid,
      channels: [memberChannel(memberId)],
    });
  } else if (existing.status === 404) {
    endpoint = await send<SvixEndpoint>('POST', `/app/${appUid}/endpoint`, {
      url,
      uid,
      channels: [memberChannel(memberId)],
    });
  } else {
    throw new ProviderRefused(PROVIDER, existing.status, existing.text);
  }
  const secret = await send<{ key: string }>('GET', `/app/${appUid}/endpoint/${endpoint.id}/secret`);
  return { id: endpoint.id, url: endpoint.url, signingSecret: secret.key };
}

export async function deleteEndpoint(venueSlug: string, memberId: string): Promise<void> {
  const response = await providerFetch(
    PROVIDER,
    `${base}/app/${applicationUid(venueSlug)}/endpoint/${endpointUid(memberId)}`,
    { method: 'DELETE', headers: headers() },
  );
  if (response.status >= 400 && response.status !== 404) {
    throw new ProviderRefused(PROVIDER, response.status, response.text);
  }
}

/** Each message carries its eventId, which is the payload's event_id and the idempotency key. */
export async function sendMessage(
  venueSlug: string,
  memberId: string,
  eventType: string,
  eventId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const response = await providerFetch(PROVIDER, `${base}/app/${applicationUid(venueSlug)}/msg`, {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json', 'idempotency-key': eventId }),
    body: JSON.stringify({
      eventType,
      eventId,
      channels: [memberChannel(memberId)],
      payload,
    }),
  });
  if (response.status >= 400 && response.status !== 409) {
    throw new ProviderRefused(PROVIDER, response.status, response.text);
  }
}

export interface DeliveryAttempt {
  message_id: string;
  event_type: string;
  event_id: string | null;
  status: 'succeeded' | 'pending' | 'failed';
  response_status: number | null;
  timestamp: string;
}

interface SvixAttempt {
  id: string;
  msgId: string;
  status: number;
  responseStatusCode: number;
  timestamp: string;
}

interface SvixMessage {
  id: string;
  eventType: string;
  eventId: string | null;
}

const ATTEMPT_STATUS: Record<number, DeliveryAttempt['status']> = {
  0: 'succeeded',
  1: 'pending',
  2: 'failed',
  3: 'failed',
};

export async function deliveryAttempts(
  venueSlug: string,
  memberId: string,
): Promise<DeliveryAttempt[]> {
  const app = applicationUid(venueSlug);
  const result = await send<{ data: SvixAttempt[] }>(
    'GET',
    `/app/${app}/attempt/endpoint/${endpointUid(memberId)}?limit=50`,
  );
  const messages = new Map<string, SvixMessage>();
  for (const messageId of new Set(result.data.map((attempt) => attempt.msgId))) {
    const message = await send<SvixMessage>('GET', `/app/${app}/msg/${messageId}`);
    messages.set(messageId, message);
  }
  return result.data.map((attempt) => ({
    message_id: attempt.msgId,
    event_type: messages.get(attempt.msgId)?.eventType ?? '',
    event_id: messages.get(attempt.msgId)?.eventId ?? null,
    status: ATTEMPT_STATUS[attempt.status] ?? 'pending',
    response_status: attempt.responseStatusCode,
    timestamp: attempt.timestamp,
  }));
}

export async function up(): Promise<boolean> {
  return reachable(PROVIDER, `${config.svix.url}/api/v1/health`);
}
