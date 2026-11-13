/** API client: one place for fetch, the single refresh, and error handling. */

export interface ApiErrorShape {
  error: string;
  message: string;
  errors?: Record<string, string>;
  retry_after?: number;
  [k: string]: unknown;
}

export class ApiFailure extends Error {
  code: string;
  status: number;
  fields: Record<string, string>;
  retryAfter: number | null;
  extra: Record<string, unknown>;
  constructor(status: number, body: ApiErrorShape) {
    super(body.message);
    this.status = status;
    this.code = body.error;
    this.fields = body.errors ?? {};
    this.retryAfter = typeof body.retry_after === "number" ? body.retry_after : null;
    this.extra = body;
  }
}

let refreshing: Promise<boolean> | null = null;

async function doFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(path, { credentials: "same-origin", ...init });
}

/** Replay after one shared refresh when access expires. */
async function call(path: string, init: RequestInit, replay = true, redirectOnSignout = true): Promise<Response> {
  const res = await doFetch(path, init);
  if (res.status === 401 && replay) {
    let ok = false;
    if (refreshing) {
      ok = await refreshing;
    } else {
      refreshing = (async () => {
        const r = await doFetch("/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        return r.ok;
      })().finally(() => { refreshing = null; });
      ok = await refreshing;
    }
    if (ok) return call(path, init, false, redirectOnSignout);
    // refresh failed: the browser goes to sign-in with the current address
    if (redirectOnSignout) onSignedOutHandler();
  }
  return res;
}

let onSignedOutHandler: () => void = () => undefined;
export function onSignedOut(fn: () => void): void {
  onSignedOutHandler = fn;
}
function jsonHeaders(): Record<string, string> {
  return { "Content-Type": "application/json; charset=utf-8" };
}

export async function api<T>(path: string, init: RequestInit = {}, opts: { silentAuth?: boolean } = {}): Promise<T> {
  const res = await call(path, init, true, opts.silentAuth !== true);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    throw new ApiFailure(res.status, (body ?? { error: "unknown", message: "Something went wrong." }) as ApiErrorShape);
  }
  return body as T;
}

export function get<T>(path: string, opts: { silentAuth?: boolean } = {}): Promise<T> {
  return api<T>(path, { method: "GET" }, opts);
}

export function post<T>(path: string, body: unknown, extra: Record<string, string> = {}): Promise<T> {
  return api<T>(path, { method: "POST", headers: { ...jsonHeaders(), ...extra }, body: JSON.stringify(body ?? {}) });
}

export function put<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: "PUT", headers: jsonHeaders(), body: JSON.stringify(body ?? {}) });
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: "PATCH", headers: jsonHeaders(), body: JSON.stringify(body ?? {}) });
}

export function del<T>(path: string): Promise<T> {
  return api<T>(path, { method: "DELETE" });
}

export async function getBlob(path: string): Promise<Blob | null> {
  const res = await call(path, { method: "GET" });
  if (!res.ok) return null;
  return res.blob();
}
