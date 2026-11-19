// Same-origin API calls. Every refusal arrives in the one published error shape.

import { F } from "../shared/feedback";
import type { ApiError } from "../shared/types";

type ApiResult<T> =
  | { ok: true; status: number; body: T; headers: Headers }
  | { ok: false; status: number; error: ApiError; headers: Headers }
  | { ok: false; status: 0; offline: true };

export async function api<T>(method: string, path: string, body?: object | FormData): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined || body instanceof FormData ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, offline: true };
  }
  const text = await response.text().catch(() => "");
  const parsed: unknown = text ? safeJson(text) : null;
  if (response.ok) return { ok: true, status: response.status, body: parsed as T, headers: response.headers };
  return { ok: false, status: response.status, error: (parsed as ApiError | null) ?? { error: "service_unavailable", message: F.SERVICE }, headers: response.headers };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
