import { config } from "./config.js";
import { FRESH_CONNECTION, providers } from "./status.js";

interface SvixAnswer { status: number; body: Record<string, unknown> }

/** One call to Svix. Network failure, a timeout and a 5xx all count as failed contact; the caller sees them as a thrown error. */
async function svix(method: string, path: string, body?: unknown, timeoutMs = 3500): Promise<SvixAnswer> {
  try {
    const answer = await fetch(`${config.svixUrl}/api/v1${path}`, {
      method,
      headers: { ...FRESH_CONNECTION, authorization: `Bearer ${config.svixApiKey}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await answer.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      parsed = {};
    }
    if (answer.status >= 500) throw new Error(`Svix answered ${answer.status}`);
    providers.svix = true;
    return { status: answer.status, body: parsed };
  } catch (error) {
    providers.svix = false;
    throw error;
  }
}

const appUid = (accountId: string): string => `stockist-${accountId}`;
const knownApps = new Set<string>();

async function ensureApp(accountId: string): Promise<void> {
  const uid = appUid(accountId);
  if (knownApps.has(uid)) return;
  const made = await svix("POST", "/app/", { name: uid, uid });
  if (made.status === 201 || made.status === 409) knownApps.add(uid);
  else throw new Error(`Svix refused the application: ${made.status}`);
}

export async function registerEndpoint(e: { id: string; accountId: string; url: string; secret: string }): Promise<void> {
  await ensureApp(e.accountId);
  const made = await svix("POST", `/app/${appUid(e.accountId)}/endpoint/`, { url: e.url, uid: e.id, secret: e.secret, channels: [e.id], description: "Interval stockist endpoint" });
  if (made.status !== 201 && made.status !== 409) throw new Error(`Svix refused the endpoint: ${made.status}`);
}

export async function removeEndpoint(accountId: string, id: string): Promise<void> {
  const gone = await svix("DELETE", `/app/${appUid(accountId)}/endpoint/${id}/`);
  if (gone.status >= 300 && gone.status !== 404) throw new Error(`Svix would not remove the endpoint: ${gone.status}`);
}

/** Hands a message over; a repeat of an event Svix already holds counts as accepted. Returns Svix's message id. */
export async function sendMessage(accountId: string, m: { eventType: string; eventId: string; payload: unknown; endpointId: string }): Promise<string> {
  const base = `/app/${appUid(accountId)}/msg/`;
  const made = await svix("POST", base, { eventType: m.eventType, eventId: m.eventId, payload: m.payload, channels: [m.endpointId] });
  if (made.status === 202 || made.status === 200 || made.status === 201) return made.body.id as string;
  if (made.status === 409) {
    const held = await svix("GET", `${base}${encodeURIComponent(m.eventId)}/`);
    if (held.status === 200) return held.body.id as string;
  }
  throw new Error(`Svix refused the message: ${made.status}`);
}

export async function resend(accountId: string, msgId: string, endpointId: string): Promise<void> {
  const sent = await svix("POST", `/app/${appUid(accountId)}/msg/${msgId}/endpoint/${endpointId}/resend/`, {});
  if (sent.status >= 300) throw new Error(`Svix would not resend: ${sent.status}`);
}

export async function rotate(accountId: string, endpointId: string, key: string): Promise<void> {
  const done = await svix("POST", `/app/${appUid(accountId)}/endpoint/${endpointId}/secret/rotate/`, { key }, 4000);
  if (done.status >= 300) throw new Error(`Svix would not rotate: ${done.status}`);
}

export interface SvixAttempt { at: string; responseStatus: number | null; outcome: "success" | "pending" | "failed" }

export async function attemptsOf(accountId: string, msgId: string, endpointId: string, timeoutMs: number): Promise<SvixAttempt[]> {
  const answer = await svix("GET", `/app/${appUid(accountId)}/attempt/msg/${msgId}/?endpoint_id=${endpointId}&limit=100`, undefined, timeoutMs);
  if (answer.status !== 200) throw new Error(`Svix attempts answered ${answer.status}`);
  const data = (answer.body.data ?? []) as { status: number; responseStatusCode: number; timestamp: string }[];
  return data.map((a) => ({
    at: a.timestamp, responseStatus: a.responseStatusCode || null,
    outcome: a.status === 0 ? "success" : a.status === 2 ? "failed" : "pending",
  }));
}

export async function touchSvix(): Promise<void> {
  await svix("GET", "/health/", undefined, 3000);
}
