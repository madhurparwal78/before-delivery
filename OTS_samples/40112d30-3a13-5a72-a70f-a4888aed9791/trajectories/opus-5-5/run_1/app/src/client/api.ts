import type { ApiErrorBody, ErrorItem } from "../shared/types.js";

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T;
  error: { code: string; message: string; items?: ErrorItem[] } | null;
}

/** Calls the same-origin API; errors come back in the one error shape. */
export async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined || body instanceof Blob ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, data: {} as T, error: { code: "NETWORK", message: "We could not reach Nightform. Try again." } };
  }
  const text = await response.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  if (response.ok) return { ok: true, status: response.status, data: parsed as T, error: null };
  const error = (parsed as Partial<ApiErrorBody>).error ?? { code: "UNKNOWN", message: "Something went wrong. Try again." };
  return { ok: false, status: response.status, data: {} as T, error };
}

export function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
