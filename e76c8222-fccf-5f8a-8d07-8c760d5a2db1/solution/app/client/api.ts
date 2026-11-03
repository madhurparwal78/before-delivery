// Same-origin JSON calls; every failure comes back as the API's error object.
import type { ApiErrorBody } from "../shared/api.js";

type ApiError = ApiErrorBody["error"];
type Result<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiError };

const NETWORK: ApiError = { code: "network", message: "The server could not be reached." };

export async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Result<T>> {
  const init: RequestInit = { method, headers: { ...headers }, credentials: "same-origin" };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { ...headers, "content-type": "application/json" };
  }
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    return { ok: false, status: 0, error: NETWORK };
  }
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  const error = (parsed as ApiErrorBody | null)?.error ?? { code: "http", message: `HTTP ${response.status}` };
  return { ok: false, status: response.status, error };
}

export const get = <T>(path: string): Promise<Result<T>> => call<T>("GET", path);

/** A fresh Idempotency-Key for one user action. */
export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
