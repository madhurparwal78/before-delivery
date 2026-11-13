/**
 * Integrator webhooks through Svix. Every event becomes one message whose
 * `eventId` is the ledger event id, carried with an Idempotency-Key header so
 * a retry can never duplicate a delivery.
 */

import { config } from '../config.ts';

export class SvixUnreachable extends Error {
  constructor(cause: string) {
    super(`Svix is unreachable: ${cause}`);
    this.name = 'SvixUnreachable';
  }
}

const APPLICATION_UID = 'quillmoor-reserve';
const APPLICATION_NAME = 'Quillmoor Reserve';
const REQUEST_TIMEOUT_MS = 4000;

async function request(
  method: string,
  path: string,
  body: unknown,
  extraHeaders: Readonly<Record<string, string>> = {},
): Promise<Response> {
  try {
    return await fetch(`${config.svixUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.svixApiKey}`,
        'content-type': 'application/json',
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SvixUnreachable(error instanceof Error ? error.message : 'unknown');
  }
}

let applicationReady = false;

/**
 * Creates the application on first use, and keeps the existing one when it is
 * already there.
 */
async function ensureApplication(): Promise<void> {
  if (applicationReady) return;
  const response = await request('POST', '/api/v1/app?get_if_exists=true', {
    uid: APPLICATION_UID,
    name: APPLICATION_NAME,
  });
  if (!response.ok) {
    throw new SvixUnreachable(`application creation answered ${response.status}`);
  }
  applicationReady = true;
}

export interface IntegratorEvent {
  readonly eventId: string;
  readonly type: string;
  readonly payload: unknown;
}

/** Sends one message. Resolves only once Svix has accepted it. */
export async function sendEvent(event: IntegratorEvent): Promise<void> {
  await ensureApplication();
  const response = await request(
    'POST',
    `/api/v1/app/${APPLICATION_UID}/msg`,
    {
      eventType: event.type,
      eventId: event.eventId,
      payload: event.payload,
    },
    { 'idempotency-key': event.eventId },
  );
  // Svix answers 409 when this eventId is already stored, which means the
  // message is delivered and the attempt need not be repeated.
  if (response.ok || response.status === 409) return;
  throw new SvixUnreachable(`message answered ${response.status}`);
}
