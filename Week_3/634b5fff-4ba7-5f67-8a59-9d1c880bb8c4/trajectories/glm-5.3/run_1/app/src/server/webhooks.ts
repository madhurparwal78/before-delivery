import { config } from './config.js';

export class SvixDown extends Error {}

const appUid = config.namespace ? `${config.namespace}-svovlstik-charity` : 'svovlstik-charity';

export async function ensureApp(): Promise<void> {
  try {
    await call('/api/v1/app/', 'POST', { uid: appUid, name: 'Svovlstik Press' });
  } catch (err) {
    if (!(err instanceof SvixDown && err.message.includes('409'))) throw err;
  }
}

async function call(path: string, method: string, body?: unknown, contentType = 'application/json'): Promise<{ status: number; body: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${config.svix.url}${path}`, {
      method,
      headers: {
        'content-type': contentType,
        authorization: `Bearer ${config.svix.apiKey}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    if (res.status >= 500) throw new SvixDown(`svix ${res.status}`);
    return { status: res.status, body: parsed };
  } catch (err) {
    if (err instanceof SvixDown) throw err;
    throw new SvixDown(String(err));
  } finally {
    clearTimeout(timer);
  }
}

export async function setEndpoint(url: string): Promise<void> {
  // Svix holds one endpoint for this app: replace it.
  await removeEndpoints();
  const res = await call(`/api/v1/app/${appUid}/endpoint/`, 'POST', { url, channels: ['main'] });
  if (res.status !== 201 && res.status !== 200) {
    throw new SvixDown(`endpoint save failed ${res.status}`);
  }
}

export async function hasEndpoint(): Promise<string | null> {
  const res = await call(`/api/v1/app/${appUid}/endpoint/`, 'GET', undefined, 'application/json');
  if (res.status !== 200) return null;
  const data = res.body?.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0].url;
}

export async function removeEndpoints(): Promise<void> {
  const res = await call(`/api/v1/app/${appUid}/endpoint/`, 'GET', undefined, 'application/json');
  if (res.status !== 200) return;
  for (const ep of res.body?.data ?? []) {
    await call(`/api/v1/app/${appUid}/endpoint/${ep.id}`, 'DELETE', undefined, 'application/json');
  }
}

export async function sendMessage(eventId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
  const res = await call(`/api/v1/app/${appUid}/msg/`, 'POST', { eventId, eventType, payload, channels: ['main'] }, 'application/json');
  if (res.status !== 202 && res.status !== 200 && res.status !== 201) {
    throw new SvixDown(`message send failed ${res.status}`);
  }
}

export interface DeliveryView { eventId: string; eventType: string; status: 'delivered' | 'retrying' | 'failed'; attempts: number; lastStatusCode: number | null }

/** Read delivery state from the webhook service on each request. */
export async function deliveries(): Promise<DeliveryView[]> {
  const out: DeliveryView[] = [];
  const events = await call(`/api/v1/app/${appUid}/msg/?limit=100`, 'GET', undefined, 'application/json');
  if (events.status !== 200) throw new SvixDown('cannot read messages');
  for (const msg of events.body?.data ?? []) {
    const attempts = await call(`/api/v1/app/${appUid}/attempt/msg/${msg.id}?limit=10&expanded_statuses=true`, 'GET', undefined, 'application/json');
    const rows: { status: number; responseStatusCode: number | null; id: string; msgId: string }[] = attempts.body?.data ?? [];
    let status: DeliveryView['status'] = 'retrying';
    let last: number | null = null;
    if (rows.length > 0) {
      last = rows[0].responseStatusCode ?? null;
      if (rows[0].status === 0) status = 'delivered';
      else if (rows[0].status === 4) status = 'failed';
      else status = 'retrying';
    }
    out.push({ eventId: msg.eventId ?? msg.id, eventType: msg.eventType, status, attempts: rows.length, lastStatusCode: last });
  }
  return out;
}
