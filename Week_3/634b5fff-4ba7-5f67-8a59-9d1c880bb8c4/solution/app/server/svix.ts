import { config, named } from "./config.js";
import { pool } from "./db.js";

/** Svix: signed, retried webhook delivery to the charity's endpoint. */

export class SvixUnreachable extends Error {
  constructor() {
    super("svix unreachable");
  }
}

const APP_UID = (): string => named("svovlstik-charity");

const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> => {
  let response: Response;
  try {
    response = await fetch(`${config.svix.url}/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${config.svix.apiKey}`, "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new SvixUnreachable();
  }
  if (response.status >= 500) throw new SvixUnreachable();
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const ensureOk = (reply: { status: number }): void => {
  if (reply.status >= 400) throw new SvixUnreachable();
};

export const ensureApplication = async (): Promise<void> => {
  const existing = await call("GET", `/app/${APP_UID()}/`);
  if (existing.status === 404) ensureOk(await call("POST", "/app/", { name: APP_UID(), uid: APP_UID() }));
  else ensureOk(existing);
};

const storedEndpoint = async (): Promise<string> => {
  const row = await pool.query("SELECT value FROM settings WHERE key = 'charity_endpoint'");
  return (row.rows[0]?.value as string | undefined) ?? config.charityWebhookUrl;
};

export const saveEndpoint = async (url: string): Promise<void> => {
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('charity_endpoint', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [url],
  );
};

/** Makes the application's single endpoint point at the current charity address, signed with the published secret. */
export const syncEndpoint = async (): Promise<void> => {
  await ensureApplication();
  const url = await storedEndpoint();
  if (!url) return;
  const listed = await call("GET", `/app/${APP_UID()}/endpoint/`);
  ensureOk(listed);
  const endpoints = (listed.body as { data: { id: string; url: string }[] }).data;
  const definition = { url, secret: config.charityWebhookSecret, version: 1, description: "Charity partner" };
  const [first, ...rest] = endpoints;
  for (const extra of rest) ensureOk(await call("DELETE", `/app/${APP_UID()}/endpoint/${extra.id}/`));
  if (!first) ensureOk(await call("POST", `/app/${APP_UID()}/endpoint/`, definition));
  else if (first.url !== url) ensureOk(await call("PUT", `/app/${APP_UID()}/endpoint/${first.id}/`, definition));
};

/** Creates the message once per event id; a duplicate event id is already sent. */
export const sendMessage = async (eventId: string, eventType: string, payload: Record<string, unknown>): Promise<void> => {
  await syncEndpoint();
  const reply = await call("POST", `/app/${APP_UID()}/msg/`, { eventId, eventType, payload });
  if (reply.status !== 409) ensureOk(reply);
};

interface Delivery {
  eventId: string;
  eventType: string;
  status: "delivered" | "retrying" | "failed";
  attempts: number;
  lastStatusCode: number | null;
}

interface SvixMessage { id: string; eventId: string | null; eventType: string }
interface SvixAttempt { msgId: string; status: number; responseStatusCode: number; timestamp: string }

const SUCCESS = 0;
const FINAL_ATTEMPT = 8;

export const listDeliveries = async (): Promise<Delivery[]> => {
  const [messages, endpoints] = await Promise.all([
    call("GET", `/app/${APP_UID()}/msg/?limit=100`),
    call("GET", `/app/${APP_UID()}/endpoint/`),
  ]);
  ensureOk(messages);
  ensureOk(endpoints);
  const sent = await Promise.all(
    (endpoints.body as { data: { id: string }[] }).data.map((endpoint) =>
      call("GET", `/app/${APP_UID()}/attempt/endpoint/${endpoint.id}/?limit=250`)),
  );
  sent.forEach(ensureOk);
  const attempts = sent.flatMap((reply) => (reply.body as { data: SvixAttempt[] }).data);
  return (messages.body as { data: SvixMessage[] }).data.map((message) => {
    const made = attempts.filter((attempt) => attempt.msgId === message.id).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const latest = made[0];
    const status = latest?.status === SUCCESS ? "delivered" : made.length >= FINAL_ATTEMPT ? "failed" : "retrying";
    return {
      eventId: message.eventId ?? message.id, eventType: message.eventType, status,
      attempts: made.length, lastStatusCode: latest?.responseStatusCode ?? null,
    } satisfies Delivery;
  });
};
