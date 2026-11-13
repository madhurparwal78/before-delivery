import { env } from '../env.js';

/** CRM events reach each client's own endpoint through the webhook service. */

export class WebhooksUnavailable extends Error {}

export type CrmEventType = 'slot.held' | 'contract.signed' | 'milestone.paid' | 'maintenance.changed';

const ENDPOINT_UID = 'crm';

async function call(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${env.svixUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${env.svixApiKey}`,
        'content-type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: controller.signal,
    });
  } catch (error) {
    throw new WebhooksUnavailable(String(error));
  } finally {
    clearTimeout(timer);
  }
}

function guard(res: Response, what: string): void {
  if (res.status >= 500) throw new WebhooksUnavailable(`${what} ${res.status}`);
}

export function applicationUid(appUserId: string): string {
  return `client-${appUserId}`;
}

/** One application per client. */
export async function ensureApplication(appUserId: string, clientName: string): Promise<string> {
  const uid = applicationUid(appUserId);
  const existing = await call(`/api/v1/app/${uid}`);
  guard(existing, 'get app');
  if (existing.ok) return uid;
  const created = await call('/api/v1/app', {
    method: 'POST',
    body: JSON.stringify({ name: clientName, uid }),
  });
  guard(created, 'create app');
  if (!created.ok && created.status !== 409) {
    throw new WebhooksUnavailable(`create app ${created.status}`);
  }
  return uid;
}

export interface EndpointDetails {
  url: string;
  signingSecret: string;
}

/** Create or update the client's one endpoint and read back its signing secret. */
export async function setEndpoint(
  appUserId: string,
  clientName: string,
  url: string,
): Promise<EndpointDetails> {
  const uid = await ensureApplication(appUserId, clientName);
  const existing = await call(`/api/v1/app/${uid}/endpoint/${ENDPOINT_UID}`);
  guard(existing, 'get endpoint');
  if (existing.ok) {
    const updated = await call(`/api/v1/app/${uid}/endpoint/${ENDPOINT_UID}`, {
      method: 'PUT',
      body: JSON.stringify({ url, description: 'CRM', uid: ENDPOINT_UID }),
    });
    guard(updated, 'update endpoint');
    if (!updated.ok) throw new WebhooksUnavailable(`update endpoint ${updated.status}`);
  } else {
    const created = await call(`/api/v1/app/${uid}/endpoint`, {
      method: 'POST',
      body: JSON.stringify({ url, description: 'CRM', uid: ENDPOINT_UID }),
    });
    guard(created, 'create endpoint');
    if (!created.ok) throw new WebhooksUnavailable(`create endpoint ${created.status}`);
  }
  return { url, signingSecret: await endpointSecret(uid) };
}

async function endpointSecret(appUid: string): Promise<string> {
  const res = await call(`/api/v1/app/${appUid}/endpoint/${ENDPOINT_UID}/secret`);
  guard(res, 'endpoint secret');
  if (!res.ok) throw new WebhooksUnavailable(`endpoint secret ${res.status}`);
  const json = (await res.json()) as { key?: string };
  return json.key ?? '';
}

export async function hasEndpoint(appUserId: string): Promise<boolean> {
  const res = await call(`/api/v1/app/${applicationUid(appUserId)}/endpoint/${ENDPOINT_UID}`);
  guard(res, 'has endpoint');
  return res.ok;
}

export interface CrmEventPayload {
  eventId: string;
  type: CrmEventType;
  occurredAt: string;
  commissionId: string;
  data: Record<string, unknown>;
}

/** Send one message, carrying the app's event id as the Svix event id. */
export async function sendEvent(
  appUserId: string,
  clientName: string,
  payload: CrmEventPayload,
): Promise<string> {
  const uid = await ensureApplication(appUserId, clientName);
  const res = await call(`/api/v1/app/${uid}/msg`, {
    method: 'POST',
    body: JSON.stringify({
      eventId: payload.eventId,
      eventType: payload.type,
      payload,
    }),
  });
  guard(res, 'send event');
  if (res.status === 409) return payload.eventId;
  if (!res.ok) throw new WebhooksUnavailable(`send event ${res.status}`);
  const json = (await res.json()) as { id?: string };
  return json.id ?? payload.eventId;
}

export interface DeliveryAttempt {
  at: string;
  responseStatus: number;
  status: 'success' | 'failed';
}

export type DeliveryFinalState = 'delivered' | 'retrying' | 'failed' | 'no_endpoint' | 'pending';

export interface Delivery {
  attempts: DeliveryAttempt[];
  finalState: DeliveryFinalState;
}

const SVIX_STATUS_SUCCESS = 0;
const SVIX_STATUS_PENDING = 1;

/** Read a message's delivery attempts from the webhook service. */
export async function readDelivery(appUserId: string, svixMessageId: string): Promise<Delivery> {
  const uid = applicationUid(appUserId);
  const res = await call(`/api/v1/app/${uid}/attempt/msg/${svixMessageId}`);
  guard(res, 'read attempts');
  if (!res.ok) return { attempts: [], finalState: 'pending' };
  const json = (await res.json()) as {
    data?: { timestamp: string; responseStatusCode: number; status: number }[];
  };
  const raw = json.data ?? [];
  const attempts: DeliveryAttempt[] = raw.map((a) => ({
    at: a.timestamp,
    responseStatus: a.responseStatusCode,
    status: a.status === SVIX_STATUS_SUCCESS ? 'success' : 'failed',
  }));
  let finalState: DeliveryFinalState = 'pending';
  if (attempts.some((a) => a.status === 'success')) finalState = 'delivered';
  else if (raw.some((a) => a.status === SVIX_STATUS_PENDING)) finalState = 'retrying';
  else if (attempts.length > 0) finalState = 'failed';
  return { attempts, finalState };
}

export async function webhooksAreUp(): Promise<boolean> {
  try {
    const res = await call('/api/v1/app?limit=1', {}, 3_000);
    return res.ok;
  } catch {
    return false;
  }
}
