import type { ErrorBody } from "../shared/api.js";

export type Result<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ErrorBody | null; network: boolean };

export async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body instanceof FormData ? headers : { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: null, network: true };
  }
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  return { ok: false, status: response.status, error: (parsed as ErrorBody | null) ?? null, network: false };
}

export const get = <T>(path: string) => request<T>("GET", path);
export const post = <T>(path: string, body: unknown = {}, headers?: Record<string, string>) => request<T>("POST", path, body, headers);
export const del = <T>(path: string) => request<T>("DELETE", path);

/** An Idempotency-Key that works on plain-http origins too (crypto.randomUUID needs a secure context). */
export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
