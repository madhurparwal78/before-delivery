// Svix: one application per client (`client-<app user id>`), one endpoint, one message per app event.
import { config } from "../config.js";
import { expectOk, reach } from "./reach.js";

function call(method: string, path: string, body?: unknown): Promise<Response> {
  return reach("svix", `${config.svix.url}/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.svix.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const clientApp = (userId: string): string => `client-${userId}`;

async function ensureApplication(userId: string, name: string): Promise<void> {
  const uid = clientApp(userId);
  const found = await call("GET", `/app/${uid}/`);
  if (found.status === 200) return;
  const created = await call("POST", "/app/", { name, uid });
  if (created.status === 409) return;
  await expectOk("svix", created, 201, 200);
}

interface SvixEndpoint {
  id: string;
  url: string;
}

/** Creates or updates the client's one endpoint and returns it with its signing secret. */
export async function upsertEndpoint(userId: string, name: string, url: string): Promise<{ id: string; secret: string }> {
  await ensureApplication(userId, name);
  const uid = clientApp(userId);
  const list = (await (await expectOk("svix", await call("GET", `/app/${uid}/endpoint/?limit=50`), 200)).json()) as { data: SvixEndpoint[] };
  const existing = list.data[0];
  const endpoint = existing
    ? ((await (await expectOk("svix", await call("PUT", `/app/${uid}/endpoint/${existing.id}/`, { url, version: 1, description: "CRM endpoint" }), 200)).json()) as SvixEndpoint)
    : ((await (await expectOk("svix", await call("POST", `/app/${uid}/endpoint/`, { url, version: 1, description: "CRM endpoint" }), 201, 200)).json()) as SvixEndpoint);
  const secret = (await (await expectOk("svix", await call("GET", `/app/${uid}/endpoint/${endpoint.id}/secret/`), 200)).json()) as { key: string };
  return { id: endpoint.id, secret: secret.key };
}

/** Creates the message with Svix eventId = the app's event id; a repeat of the same event id is a no-op. */
export async function createMessage(userId: string, name: string, eventId: string, eventType: string, payload: unknown): Promise<void> {
  await ensureApplication(userId, name);
  const response = await call("POST", `/app/${clientApp(userId)}/msg/`, { eventType, eventId, payload });
  if (response.status === 409) return;
  await expectOk("svix", response, 202, 200, 201);
}

interface SvixAttempt {
  timestamp: string;
  responseStatusCode: number;
  status: number;
}

interface SvixMessageEndpoint {
  status: number;
  nextAttempt: string | null;
}

interface Delivery {
  attempts: { at: string; responseStatus: number; status: "success" | "failed" }[];
  finalState: "delivered" | "retrying" | "failed" | "no_endpoint" | "pending";
}

/** Attempts and final state of one event, read from Svix. Null when Svix has no such message yet. */
export async function delivery(userId: string, eventId: string, hasEndpoint: boolean): Promise<Delivery | null> {
  const uid = clientApp(userId);
  const message = await call("GET", `/app/${uid}/msg/${eventId}/`);
  if (message.status === 404) return null;
  await expectOk("svix", message, 200);
  const attempts = (await (await expectOk("svix", await call("GET", `/app/${uid}/attempt/msg/${eventId}/?limit=100`), 200)).json()) as { data: SvixAttempt[] };
  const rows = attempts.data
    .map((a) => ({ at: a.timestamp, responseStatus: a.responseStatusCode, status: a.status === 0 ? ("success" as const) : ("failed" as const) }))
    .sort((a, b) => a.at.localeCompare(b.at));
  if (rows.some((r) => r.status === "success")) return { attempts: rows, finalState: "delivered" };
  if (!hasEndpoint) return { attempts: rows, finalState: "no_endpoint" };
  if (!rows.length) return { attempts: rows, finalState: "pending" };
  const endpoints = (await (await expectOk("svix", await call("GET", `/app/${uid}/msg/${eventId}/endpoint/?limit=10`), 200)).json()) as { data: SvixMessageEndpoint[] };
  const gaveUp = endpoints.data.length > 0 && endpoints.data.every((e) => e.status === 2 && !e.nextAttempt);
  return { attempts: rows, finalState: gaveUp ? "failed" : "retrying" };
}

