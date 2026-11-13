import type { ApiErrorBody } from "./types";

export const OFFLINE_COPY = "Couldn't reach Crosshand Relay. Check your connection and try again.";

export type Result<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ApiErrorBody }
  | { ok: false; status: 0; error: null };

let onSignedOut: () => void = () => undefined;

/** Called when any call finds the session gone, so the app can return to Sign in. */
export function whenSignedOut(handler: () => void): void {
  onSignedOut = handler;
}

/** One call to the API. Never throws: a refusal or a lost connection comes back as a result. */
export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined || body instanceof FormData ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: null };
  }
  if (response.status === 204) return { ok: true, status: 204, data: undefined as T };
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, status: 0, error: null };
  }
  if (response.ok) return { ok: true, status: response.status, data: payload as T };
  const error = (payload as { error: ApiErrorBody }).error;
  if (error.code === "unauthenticated") onSignedOut();
  return { ok: false, status: response.status, error };
}

/** A fresh Idempotency-Key for one close or cancel attempt. */
export function idempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
