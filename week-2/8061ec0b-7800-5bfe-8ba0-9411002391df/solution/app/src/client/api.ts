// The browser's only door to the server: same-origin JSON calls that never throw on an HTTP error.

import type { ApiErrorBody } from "../shared/api.js";
import { observeServerNow } from "./serverClock.js";

export const NETWORK_COPY = "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ApiErrorBody["error"] | null };

export async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown,
  headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method, credentials: "same-origin",
      headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: null };
  }
  const text = await response.text().catch(() => "");
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const error = parsed !== null && typeof parsed === "object" && "error" in parsed ? (parsed as ApiErrorBody).error : null;
    return { ok: false, status: response.status, error };
  }
  if (parsed !== null && typeof parsed === "object" && "server_now" in parsed && typeof parsed.server_now === "string") {
    observeServerNow(parsed.server_now);
  }
  return { ok: true, status: response.status, data: parsed as T };
}

/** Multipart upload (condition photos). */
export async function upload<T>(path: string, form: FormData): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, { method: "POST", credentials: "same-origin", body: form });
  } catch {
    return { ok: false, status: 0, error: null };
  }
  const parsed: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = parsed !== null && typeof parsed === "object" && "error" in parsed ? (parsed as ApiErrorBody).error : null;
    return { ok: false, status: response.status, error };
  }
  return { ok: true, status: response.status, data: parsed as T };
}

/** The network / 500 copy for any failure the screen has no specific copy for. */
export function isNetworkOrServerFailure(result: { ok: false; status: number }): boolean {
  return result.status === 0 || result.status >= 500 && result.status !== 503;
}

/** An idempotency key for one money action attempt (works on plain-http origins too). */
export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
