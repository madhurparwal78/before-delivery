/** Svix: one application per mission, one endpoint per subscriber, one signed message per change. */

import { config, DEPENDENCY_TIMEOUT_MS } from "../config.js";
import { DependencyDown } from "../errors.js";

export const WEBHOOK_EVENT_TYPES = [
  "pass.parsed",
  "pass.rejected",
  "pass.deleted",
  "event.pinned",
  "share.revoked",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

type SvixCall = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
  timeoutMs?: number;
};

async function call(request: SvixCall): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${config.svix.url}${request.path}`, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${config.svix.apiKey}`,
        ...(request.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: AbortSignal.timeout(request.timeoutMs ?? DEPENDENCY_TIMEOUT_MS),
    });
  } catch (error) {
    throw new DependencyDown("webhooks", String(error));
  }
  if (response.status >= 500) {
    throw new DependencyDown("webhooks", `status ${response.status}`);
  }
  const text = await response.text();
  return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null };
}

export async function probeWebhooks(): Promise<boolean> {
  try {
    const { status } = await call({ method: "GET", path: "/api/v1/app?limit=1" });
    return status < 400;
  } catch {
    return false;
  }
}

export async function ensureEventTypes(): Promise<void> {
  for (const eventType of WEBHOOK_EVENT_TYPES) {
    await call({
      method: "POST",
      path: "/api/v1/event-type",
      body: { name: eventType, description: `Perilune Ledger ${eventType}` },
    });
  }
}

async function ensureApplication(missionId: string, missionName: string): Promise<void> {
  const existing = await call({ method: "GET", path: `/api/v1/app/${missionId}` });
  if (existing.status === 200) {
    return;
  }
  const created = await call({
    method: "POST",
    path: "/api/v1/app",
    body: { name: missionName, uid: missionId },
  });
  if (created.status >= 400 && created.status !== 409) {
    throw new DependencyDown("webhooks", `application create failed: ${created.status}`);
  }
}

export async function createEndpoint(
  missionId: string,
  missionName: string,
  url: string,
): Promise<string> {
  await ensureApplication(missionId, missionName);
  const created = await call({
    method: "POST",
    path: `/api/v1/app/${missionId}/endpoint`,
    body: { url, filterTypes: [...WEBHOOK_EVENT_TYPES] },
  });
  if (created.status >= 400) {
    throw new DependencyDown("webhooks", `endpoint create failed: ${created.status}`);
  }
  const id = (created.body as { id?: string }).id;
  if (!id) {
    throw new DependencyDown("webhooks", "endpoint id missing");
  }
  return id;
}

export async function deleteEndpoint(missionId: string, endpointId: string): Promise<void> {
  const removed = await call({
    method: "DELETE",
    path: `/api/v1/app/${missionId}/endpoint/${endpointId}`,
  });
  if (removed.status >= 400 && removed.status !== 404) {
    throw new DependencyDown("webhooks", `endpoint delete failed: ${removed.status}`);
  }
}

export type WebhookMessage = {
  eventType: WebhookEventType;
  eventId: string;
  payload: Record<string, unknown>;
};

/** The service's event ids admit only `[a-zA-Z0-9-_.]`, so the separator is a dot. */
function serviceEventId(eventId: string): string {
  return eventId.replace(":", ".");
}

/** Sends one message; true when the service accepted it (or already holds its event id). */
export async function sendMessage(
  missionId: string,
  missionName: string,
  message: WebhookMessage,
): Promise<boolean> {
  await ensureApplication(missionId, missionName);
  const created = await call({
    method: "POST",
    path: `/api/v1/app/${missionId}/msg`,
    body: {
      eventType: message.eventType,
      eventId: serviceEventId(message.eventId),
      payload: message.payload,
    },
  });
  if (created.status === 409) {
    return true;
  }
  if (created.status >= 400) {
    throw new DependencyDown("webhooks", `message create failed: ${created.status}`);
  }
  return true;
}
