import { config } from "./config.js";
import { ProviderDown } from "./errors.js";

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${config.svix.apiKey}`, "Content-Type": "application/json", ...headers },
    signal: AbortSignal.timeout(8000),
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  let response: Response;
  try {
    response = await fetch(`${config.svix.url}/api/v1${path}`, init);
  } catch (error) {
    throw new ProviderDown("svix", error instanceof Error ? error.message : String(error));
  }
  if (response.status >= 500) throw new ProviderDown("svix", `${method} ${path} HTTP ${response.status}`);
  return response;
}

async function json<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) throw new Error(`Svix ${what}: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
  return (await response.json()) as T;
}

export async function reachable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.svix.url}/api/v1/health/`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

const appUid = (venueSlug: string): string => `venue-${venueSlug}`;
const memberChannel = (memberId: string): string => `member-${memberId}`;

export async function ensureApp(venueSlug: string, venueName: string): Promise<void> {
  await json(await call("POST", "/app/?get_if_exists=true", { name: venueName, uid: appUid(venueSlug) }), "create application");
}

interface EndpointJson {
  id: string;
  url: string;
}

/** Creates or updates the builder's one endpoint and returns its id and signing secret. */
export async function upsertEndpoint(venueSlug: string, memberId: string, url: string): Promise<{ id: string; secret: string }> {
  const app = appUid(venueSlug);
  const uid = memberChannel(memberId);
  const spec = { url, uid, channels: [uid], version: 1, description: "Plumtide Venue builder endpoint" };
  const existing = await call("GET", `/app/${app}/endpoint/${uid}/`);
  const endpoint =
    existing.status === 404
      ? await json<EndpointJson>(await call("POST", `/app/${app}/endpoint/`, spec), "create endpoint")
      : await json<EndpointJson>(await call("PUT", `/app/${app}/endpoint/${uid}/`, spec), "update endpoint");
  const secret = await json<{ key: string }>(await call("GET", `/app/${app}/endpoint/${endpoint.id}/secret/`), "endpoint secret");
  return { id: endpoint.id, secret: secret.key };
}

export async function deleteEndpoint(venueSlug: string, memberId: string): Promise<void> {
  const response = await call("DELETE", `/app/${appUid(venueSlug)}/endpoint/${memberChannel(memberId)}/`);
  if (!response.ok && response.status !== 404) throw new Error(`Svix delete endpoint: HTTP ${response.status}`);
}

export interface WebhookMessage {
  venueSlug: string;
  venueName: string;
  memberId: string;
  eventType: string;
  payload: { event_id: string } & Record<string, unknown>;
}

export async function sendMessage(message: WebhookMessage): Promise<void> {
  await ensureApp(message.venueSlug, message.venueName);
  const response = await call(
    "POST",
    `/app/${appUid(message.venueSlug)}/msg/`,
    { eventType: message.eventType, eventId: message.payload.event_id, channels: [memberChannel(message.memberId)], payload: message.payload },
    { "idempotency-key": message.payload.event_id },
  );
  if (!response.ok && response.status !== 409) throw new Error(`Svix send message: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
}

interface AttemptJson {
  msgId: string;
  status: number;
  responseStatusCode: number;
  timestamp: string;
}

interface EndpointMessageJson {
  id: string;
  eventType: string;
  eventId?: string | null;
}

interface Attempt {
  message_id: string;
  event_type: string;
  event_id: string | null;
  status: "succeeded" | "pending" | "failed";
  response_status: number;
  timestamp: string;
}

const ATTEMPT_STATUS: Record<number, Attempt["status"]> = { 0: "succeeded", 1: "pending", 2: "failed", 3: "pending" };

/** Svix's attempts for the endpoint, each joined with its message's event type and id. */
export async function attempts(venueSlug: string, endpointId: string): Promise<Attempt[]> {
  const app = `/app/${appUid(venueSlug)}`;
  const [attemptPage, messagePage] = await Promise.all([
    call("GET", `${app}/attempt/endpoint/${endpointId}/?limit=50`).then((response) => json<{ data: AttemptJson[] }>(response, "list attempts")),
    call("GET", `${app}/endpoint/${endpointId}/msg/?limit=50&with_content=false`).then((response) => json<{ data: EndpointMessageJson[] }>(response, "list endpoint messages")),
  ]);
  const messages = new Map(messagePage.data.map((message) => [message.id, message]));
  return attemptPage.data.map((attempt) => ({
    message_id: attempt.msgId,
    event_type: messages.get(attempt.msgId)?.eventType ?? "",
    event_id: messages.get(attempt.msgId)?.eventId ?? null,
    status: ATTEMPT_STATUS[attempt.status] ?? "pending",
    response_status: attempt.responseStatusCode,
    timestamp: attempt.timestamp,
  }));
}
