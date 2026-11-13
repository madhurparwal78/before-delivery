import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { serviceStates, withTimeout } from './state.js';

const CONTACT_TIMEOUT_MS = 2_000;

export class SvixUnavailable extends Error {}

export interface SvixAttempt {
  at: string;
  responseStatus: number | null;
  outcome: 'success' | 'pending' | 'failed';
}

export function newSigningSecret(): string {
  return `whsec_${randomBytes(24).toString('base64')}`;
}

export function applicationUid(accountId: string): string {
  return `stockist-${accountId}`;
}

async function call(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  let response: Response;
  try {
    response = await withTimeout(
      (signal) =>
        fetch(`${config.svixUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${config.svixApiKey}`,
            'content-type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal,
        }),
      CONTACT_TIMEOUT_MS,
    );
  } catch {
    serviceStates.svix.record(false);
    throw new SvixUnavailable('svix unreachable');
  }
  const text = await response.text();
  if (response.status >= 500) {
    serviceStates.svix.record(false);
    throw new SvixUnavailable(`svix answered ${response.status}`);
  }
  serviceStates.svix.record(true);
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, json };
}

export async function ensureApplication(accountId: string, displayName: string): Promise<void> {
  await call('POST', '/api/v1/app/?get_if_exists=true', { name: displayName, uid: applicationUid(accountId) });
}

export async function createEndpoint(
  accountId: string,
  endpointId: string,
  url: string,
  secret: string,
): Promise<string> {
  const result = await call('POST', `/api/v1/app/${applicationUid(accountId)}/endpoint/`, {
    url,
    uid: endpointId,
    description: `Interval stockist endpoint ${endpointId}`,
    secret,
    channels: [endpointId],
  });
  if (result.status === 409) {
    const existing = await call('GET', `/api/v1/app/${applicationUid(accountId)}/endpoint/${endpointId}`);
    return (existing.json as { id?: string }).id ?? '';
  }
  return (result.json as { id?: string }).id ?? '';
}

export async function deleteEndpoint(accountId: string, endpointId: string): Promise<void> {
  await call('DELETE', `/api/v1/app/${applicationUid(accountId)}/endpoint/${endpointId}`);
}

export async function rotateEndpointSecret(
  accountId: string,
  endpointId: string,
  secret: string,
): Promise<void> {
  const result = await call(
    'POST',
    `/api/v1/app/${applicationUid(accountId)}/endpoint/${endpointId}/secret/rotate`,
    { key: secret },
  );
  if (result.status >= 400) throw new SvixUnavailable(`svix refused rotation with ${result.status}`);
}

export async function sendMessage(
  accountId: string,
  endpointId: string,
  eventId: string,
  eventType: string,
  payload: unknown,
): Promise<string> {
  const result = await call('POST', `/api/v1/app/${applicationUid(accountId)}/msg/`, {
    eventType,
    eventId,
    payload,
    channels: [endpointId],
  });
  if (result.status === 409) return eventId;
  if (result.status >= 400) throw new SvixUnavailable(`svix refused the message with ${result.status}`);
  return (result.json as { id?: string }).id ?? eventId;
}

export async function resendMessage(accountId: string, eventId: string, endpointId: string): Promise<void> {
  const result = await call(
    'POST',
    `/api/v1/app/${applicationUid(accountId)}/msg/${eventId}/endpoint/${endpointId}/resend`,
    {},
  );
  if (result.status >= 400 && result.status !== 409) {
    throw new SvixUnavailable(`svix refused the resend with ${result.status}`);
  }
}

interface RawAttempt {
  timestamp: string;
  responseStatusCode: number | null;
  status: number;
}

export async function listAttempts(accountId: string, eventId: string): Promise<SvixAttempt[]> {
  const result = await call('GET', `/api/v1/app/${applicationUid(accountId)}/attempt/msg/${eventId}/`);
  if (result.status === 404) return [];
  const data = (result.json as { data?: RawAttempt[] }).data ?? [];
  return data
    .map((attempt) => ({
      at: attempt.timestamp,
      responseStatus: attempt.responseStatusCode ?? null,
      outcome: outcomeOf(attempt.status),
    }))
    .sort((a, b) => (a.at < b.at ? -1 : 1));
}

function outcomeOf(status: number): 'success' | 'pending' | 'failed' {
  if (status === 0) return 'success';
  if (status === 2) return 'failed';
  return 'pending';
}

export async function pingSvix(): Promise<void> {
  try {
    await call('GET', '/api/v1/app/?limit=1');
  } catch {
    /* the contact result is already recorded */
  }
}

export function svixDown(): boolean {
  return serviceStates.svix.down;
}
