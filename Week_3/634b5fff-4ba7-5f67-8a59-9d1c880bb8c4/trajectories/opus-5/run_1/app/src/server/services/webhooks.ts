import { config, names } from '../config.js';

export class WebhooksUnreachable extends Error {}

const ENDPOINT_UID = 'charity-endpoint';

/** The webhook service's own delivery statuses. */
const SUCCESS = 0;
const PENDING = 1;
const SENDING = 3;

async function call(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${config.svix.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.svix.apiKey}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new WebhooksUnreachable(`svix ${response.status} ${text.slice(0, 160)}`);
    return text === '' ? null : (JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof WebhooksUnreachable) throw error;
    throw new WebhooksUnreachable(String(error));
  } finally {
    clearTimeout(timer);
  }
}

export async function ensureApplication(): Promise<string> {
  await call('POST', '/api/v1/app/?get_if_exists=true', {
    name: 'Svovlstik Press charity events',
    uid: names.svixApplication,
  });
  return names.svixApplication;
}

interface EndpointRow {
  id: string;
  uid: string | null;
}

/** The charity endpoint, signed with the published secret. */
export async function setCharityEndpoint(url: string): Promise<void> {
  const appId = await ensureApplication();
  const listed = (await call('GET', `/api/v1/app/${appId}/endpoint/?limit=50`)) as {
    data: EndpointRow[];
  };
  const found = listed.data.find((endpoint) => endpoint.uid === ENDPOINT_UID);
  if (found === undefined) {
    await call('POST', `/api/v1/app/${appId}/endpoint/`, {
      url,
      uid: ENDPOINT_UID,
      secret: config.charityWebhookSecret,
      description: 'Varmestuen Nord',
    });
    return;
  }
  await call('PUT', `/api/v1/app/${appId}/endpoint/${found.id}/`, {
    url,
    uid: ENDPOINT_UID,
    description: 'Varmestuen Nord',
  });
  await call('POST', `/api/v1/app/${appId}/endpoint/${found.id}/secret/rotate/`, {
    key: config.charityWebhookSecret,
  });
}

export type CharityEventType = 'order.paid' | 'refund.settled' | 'statement.issued';

export async function sendCharityEvent(
  eventType: CharityEventType,
  eventId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const appId = await ensureApplication();
  await call('POST', `/api/v1/app/${appId}/msg/`, { eventType, eventId, payload }, eventId);
}

export interface DeliveryRow {
  eventId: string;
  eventType: string;
  status: 'delivered' | 'retrying' | 'failed';
  attempts: number;
  lastStatusCode: number | null;
}

interface MessageRow {
  id: string;
  eventId: string | null;
  eventType: string;
}

interface AttemptRow {
  status: number;
  responseStatusCode: number;
  timestamp: string;
}

/** Delivery state as the webhook service reports it, read on each request. */
export async function readDeliveries(): Promise<DeliveryRow[]> {
  const appId = await ensureApplication();
  const messages = (await call('GET', `/api/v1/app/${appId}/msg/?limit=50`)) as { data: MessageRow[] };
  const rows: DeliveryRow[] = [];
  for (const message of messages.data) {
    const attempts = (await call(
      'GET',
      `/api/v1/app/${appId}/attempt/msg/${message.id}/?limit=50`,
    )) as { data: AttemptRow[] };
    const ordered = [...attempts.data].sort((left, right) =>
      left.timestamp.localeCompare(right.timestamp),
    );
    const last = ordered[ordered.length - 1];
    const delivered = ordered.some((attempt) => attempt.status === SUCCESS);
    const inFlight =
      last === undefined || last.status === PENDING || last.status === SENDING;
    rows.push({
      eventId: message.eventId ?? message.id,
      eventType: message.eventType,
      status: delivered ? 'delivered' : inFlight ? 'retrying' : 'failed',
      attempts: ordered.length,
      lastStatusCode: last === undefined ? null : last.responseStatusCode,
    });
  }
  return rows;
}
