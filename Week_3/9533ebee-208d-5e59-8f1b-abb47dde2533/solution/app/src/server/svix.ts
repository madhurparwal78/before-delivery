import { config } from "./config.js";
import type { EventPayload } from "./events.js";

// Integrator webhooks are delivered by Svix: one message per event, under the application `quillmoor-reserve`.

const APPLICATION_UID = "quillmoor-reserve";
let applicationReady = false;

async function call(method: "POST", path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${config.svix.url}/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${config.svix.apiKey}`, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
}

/** Creates the Svix application on first use and keeps the existing one if there is one. */
async function ensureApplication(): Promise<void> {
  if (applicationReady) return;
  let response = await call("POST", "/app/?get_if_exists=true", { name: "Quillmoor Reserve", uid: APPLICATION_UID });
  // 409: another process created the application in the same instant, so asking again finds it.
  if (response.status === 409) response = await call("POST", "/app/?get_if_exists=true", { name: "Quillmoor Reserve", uid: APPLICATION_UID });
  if (!response.ok) throw new Error(`Svix application: ${response.status}`);
  applicationReady = true;
}

/** Creates the application at start, and again every 10 seconds until Svix is reachable; first use also creates it. */
export function watchApplication(): void {
  const attempt = () => {
    ensureApplication().catch((error: unknown) => {
      console.error("Svix application not ready, retrying in 10 s:", error instanceof Error ? error.message : error);
      setTimeout(attempt, 10_000);
    });
  };
  attempt();
}

/** Sends the event as one message. The event id is the message id and the Idempotency-Key, so a resend is harmless. */
export async function deliverEvent(event: EventPayload): Promise<void> {
  await ensureApplication();
  const response = await call(
    "POST",
    `/app/${APPLICATION_UID}/msg/`,
    { eventType: event.type, eventId: event.event_id, payload: event },
    { "Idempotency-Key": event.event_id },
  );
  // 409: Svix already holds a message with this event id, so it was accepted on an earlier attempt.
  if (!response.ok && response.status !== 409) throw new Error(`Svix message ${event.event_id}: ${response.status}`);
}
