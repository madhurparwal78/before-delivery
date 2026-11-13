// Svix: signed outbound webhooks. One application per mission; one endpoint
// per subscriber; one message per reported change.

import { DependencyError, fetchWithTimeout, requireEnv } from "./deps.js";

function base(): string {
  return requireEnv("SVIX_URL").replace(/\/$/, "");
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${requireEnv("SVIX_API_KEY")}`,
    "Content-Type": "application/json",
  };
}

async function svix<T>(
  path: string,
  init: RequestInit,
  timeoutMs = 3000,
): Promise<{ status: number; body: T | null }> {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(authHeaders())) headers.set(k, v);
  let response: Response;
  try {
    response = await fetchWithTimeout(`${base()}${path}`, { ...init, headers }, timeoutMs);
  } catch {
    throw new DependencyError("webhooks");
  }
  const text = await response.text().catch(() => "");
  let body: T | null = null;
  if (text !== "") {
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = null;
    }
  }
  return { status: response.status, body };
}

export const EVENT_TYPES = [
  "pass.parsed",
  "pass.rejected",
  "pass.deleted",
  "event.pinned",
  "share.revoked",
] as const;

export type WebhookEventType = (typeof EVENT_TYPES)[number];

export async function ensureEventTypes(): Promise<void> {
  for (const name of EVENT_TYPES) {
    await svix("/api/v1/event-type/", {
      method: "POST",
      body: JSON.stringify({ name, description: name }),
    }).catch(() => undefined);
  }
}

export async function ensureApplication(
  missionId: string,
  missionName: string,
): Promise<void> {
  const result = await svix<unknown>("/api/v1/app/", {
    method: "POST",
    body: JSON.stringify({ uid: missionId, name: missionName }),
  });
  // 409 means the application already exists: it is reused.
  if (result.status === 201 || result.status === 200 || result.status === 409) return;
  throw new DependencyError("webhooks");
}

export interface SvixEndpoint {
  id: string;
  url: string;
}

export async function createEndpoint(
  missionId: string,
  url: string,
): Promise<SvixEndpoint> {
  const result = await svix<SvixEndpoint>(`/api/v1/app/${missionId}/endpoint/`, {
    method: "POST",
    body: JSON.stringify({ url, filterTypes: [...EVENT_TYPES] }),
  });
  if (result.status !== 201 || !result.body) {
    throw new DependencyError("webhooks");
  }
  return result.body;
}

export async function deleteEndpoint(missionId: string, endpointId: string): Promise<void> {
  const result = await svix<null>(`/api/v1/app/${missionId}/endpoint/${endpointId}`, {
    method: "DELETE",
  });
  if (result.status !== 204) {
    throw new DependencyError("webhooks");
  }
}

export async function createMessage(
  missionId: string,
  eventType: WebhookEventType,
  eventId: string,
  payload: Record<string, unknown>,
): Promise<"sent" | "duplicate"> {
  // Svix event ids allow [a-zA-Z0-9\-_.]; ':' is encoded as '_'.
  const svixId = eventId.replace(/:/g, "_");
  const result = await svix<null>(`/api/v1/app/${missionId}/msg/`, {
    method: "POST",
    body: JSON.stringify({ eventType, eventId: svixId, payload }),
  });
  if (result.status === 202 || result.status === 201 || result.status === 200) {
    return "sent";
  }
  if (result.status === 409) {
    return "duplicate";
  }
  throw new DependencyError("webhooks");
}

export async function probeWebhooks(): Promise<boolean> {
  try {
    const result = await svix<unknown>("/api/v1/app/?limit=1", { method: "GET" }, 1000);
    return result.status === 200;
  } catch {
    return false;
  }
}

export function buildWebhookPayload(
  eventType: WebhookEventType,
  missionId: string,
  version: number,
  occurredAtMs: number,
  data: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: eventType,
    mission_id: missionId,
    version,
    occurred_at: Math.floor(occurredAtMs / 1000),
    data,
  };
}
