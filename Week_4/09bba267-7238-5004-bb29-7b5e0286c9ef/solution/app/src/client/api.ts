// Same-origin JSON requests. Every answer comes back as data or the API's error shape; nothing throws.
import type { ApiError } from "../shared/types.js";

export type Answer<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiError };

export async function request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<Answer<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  try {
    const response = await fetch(path, {
      method, headers, credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const parsed: unknown = text ? JSON.parse(text) : null;
    return response.ok
      ? { ok: true, status: response.status, data: parsed as T }
      : { ok: false, status: response.status, error: (parsed ?? { error: "unknown" }) as ApiError };
  } catch {
    return { ok: false, status: 0, error: { error: "network" } };
  }
}

export const get = <T>(path: string): Promise<Answer<T>> => request<T>("GET", path);

export const newKey = (): string => crypto.randomUUID();
