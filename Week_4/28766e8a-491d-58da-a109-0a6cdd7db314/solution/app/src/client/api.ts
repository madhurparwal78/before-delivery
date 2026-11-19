// JSON over fetch to the app's own /api (same origin only).
import type { ErrorBody } from "../shared/errors";

type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ErrorBody["error"] };

export async function api<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
    credentials: "same-origin",
  });
  if (res.status === 204) return { ok: true, status: 204, data: undefined as T };
  const data = (await res.json()) as T | ErrorBody;
  if (res.ok) return { ok: true, status: res.status, data: data as T };
  return { ok: false, status: res.status, error: (data as ErrorBody).error };
}
