import type { ServiceState, ServiceStatus } from "../shared/api.js";
import { ApiError } from "./http.js";

// Each dependency's last known state. Every real call reports its outcome here, and the probes in
// main.ts refresh all four every 5 seconds, so /api/status is never older than 10 seconds.

export type Service = keyof ServiceStatus;

const state: ServiceStatus = { payments: "down", email: "down", storage: "down", documents: "down" };

export function mark(service: Service, value: ServiceState): void {
  state[service] = value;
}

export function snapshot(): ServiceStatus {
  return { ...state };
}

const UNAVAILABLE: Record<Service, string> = {
  payments: "payment_unavailable",
  email: "email_unavailable",
  storage: "storage_unavailable",
  documents: "documents_unavailable",
};

/** A provider that could not be reached: marks it down at once and answers the brief's 503. */
export function unreachable(service: Service): ApiError {
  mark(service, "down");
  return new ApiError(503, UNAVAILABLE[service]);
}

/** fetch with a timeout; any network failure or 5xx marks the service down and throws the 503 answer. */
export async function call(service: Service, url: string, init: RequestInit, timeoutMs = 15_000): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw unreachable(service);
  }
  if (response.status >= 500) {
    await response.body?.cancel();
    throw unreachable(service);
  }
  mark(service, "up");
  return response;
}
