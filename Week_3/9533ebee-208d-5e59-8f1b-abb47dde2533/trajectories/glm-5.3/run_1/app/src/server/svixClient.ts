import type { OutboxEvent } from './events.js';
import { getConfig } from './config.js';

const APP_UID = 'quillmoor-reserve';
const APP_NAME = 'Quillmoor Reserve';

interface SvixResponse {
  id?: string;
}

/** Ensure the application exists, then send one message. Idempotent by event id. */
export async function deliverEvent(event: OutboxEvent): Promise<void> {
  const cfg = getConfig();
  const auth = authHeader();
  await ensureApplication(auth);
  const url = `${cfg.svixUrl.replace(/\/$/, '')}/api/v1/app/${APP_UID}/msg/`;
  const payload = {
    event_id: event.event_id,
    type: event.type,
    position_id: event.position_id,
    sequence: event.sequence,
    occurred_at: event.occurred_at,
    data: event.data,
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json',
      'Idempotency-Key': event.event_id,
    },
    body: JSON.stringify({
      eventType: event.type,
      eventId: event.event_id,
      payload,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status >= 500 || response.status === 429) {
    throw new Error(`svix unavailable: ${response.status}`);
  }
  if (response.status >= 400) {
    const text = await response.text();
    if (text.includes('duplicate') || response.status === 409) return;
    throw new Error(`svix rejected: ${response.status} ${text}`);
  }
  await response.json().catch((): SvixResponse => ({}));
}

let appChecked = false;

async function ensureApplication(auth: string): Promise<void> {
  if (appChecked) return;
  const cfg = getConfig();
  const base = cfg.svixUrl.replace(/\/$/, '');
  const existing = await fetch(`${base}/api/v1/app/${APP_UID}/`, {
    headers: { Authorization: auth },
    signal: AbortSignal.timeout(5_000),
  });
  if (existing.status === 200) {
    appChecked = true;
    return;
  }
  const created = await fetch(`${base}/api/v1/app/`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: APP_UID, name: APP_NAME }),
    signal: AbortSignal.timeout(5_000),
  });
  if (created.status === 200 || created.status === 201) {
    appChecked = true;
    return;
  }
  if (created.status === 400) {
    appChecked = true;
    return;
  }
  throw new Error(`svix app create failed: ${created.status}`);
}

function authHeader(): string {
  const cfg = getConfig();
  const token = cfg.svixApiKey;
  const needsScheme = !token.startsWith('Bearer ') && token.split('.').length === 3;
  return needsScheme ? `Bearer ${token}` : token;
}
