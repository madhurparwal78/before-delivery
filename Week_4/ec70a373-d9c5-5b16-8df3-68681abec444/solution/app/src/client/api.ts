// Same-origin API calls: the CSRF header, the error body, the server-now estimate and the handling of a 401.
import type { ApiErrorBody } from "../shared/api.ts";
import { sessionAnswered401 } from "./session.ts";
import { requestEnded, requestStarted } from "./firstPaint.ts";

type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ApiErrorBody["error"]; retryAfter?: number }
  | { ok: false; status: 0; error: null };

let clockOffset = 0;

/** The server-now estimate: the browser clock plus the offset from the latest response's Date header. */
export function serverNow(): number {
  return Date.now() + clockOffset;
}

/** Keeps the offset between this response's Date header and the browser clock at the moment it arrived. */
function noteServerClock(response: Response): void {
  const header = response.headers.get("date");
  if (!header) return;
  const at = Date.parse(header);
  if (Number.isNaN(at)) return;
  clockOffset = at - Date.now();
}

function csrfToken(): string | null {
  const found = document.cookie.split("; ").find((part) => part.startsWith("pl_csrf="));
  return found ? found.slice("pl_csrf=".length) : null;
}

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  form?: FormData;
  idempotencyKey?: string;
  /** The dialog's own action: after a 401 it waits for Sign in again and is resent exactly once. */
  resumable?: boolean;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  const token = csrfToken();
  if (method !== "GET" && token) headers["X-CSRF-Token"] = token;
  return fetch(path, { method, headers, body, credentials: "same-origin" });
}

const resends = new Map<string, Promise<unknown>>();

export async function api<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  requestStarted();
  try {
    return await request<T>(path, options);
  } finally {
    requestEnded();
  }
}

async function request<T>(path: string, options: RequestOptions): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await send(path, options);
  } catch {
    return { ok: false, status: 0, error: null };
  }
  noteServerClock(response);
  if (response.status === 401 && path !== "/api/session") {
    const resume = sessionAnswered401(options.resumable === true);
    if (resume) {
      await resume;
      // However many presses waited for Sign in again, the action is resent exactly once.
      const id = `${options.method ?? "GET"} ${path} ${options.idempotencyKey ?? ""}`;
      const resend = resends.get(id) ?? api<T>(path, options).finally(() => resends.delete(id));
      resends.set(id, resend);
      return resend as Promise<ApiResult<T>>;
    }
  }
  if (response.status === 204) return { ok: true, status: 204, data: undefined as T };
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  const error = (parsed as ApiErrorBody | null)?.error ?? { code: "internal", message: "" };
  const retryAfter = Number(response.headers.get("retry-after"));
  return { ok: false, status: response.status, error, retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined };
}

export function newKey(): string {
  return crypto.randomUUID();
}

export const DROPPED = "Can't reach Pilotlight. Check your connection and try again.";
const BROKEN = "Something went wrong. Refresh to see the current state.";
const CSRF_FAILED = "Your session changed in another tab. Refresh and try again.";

/** The copy for an error answer: the action's own table, then the shared csrf, 500 and dropped-connection copy. */
export function errorCopy(result: { status: number; error: ApiErrorBody["error"] | null }, table: Record<string, string>): string {
  if (result.error === null) return DROPPED;
  if (result.error.code === "csrf_failed") return CSRF_FAILED;
  return table[result.error.code] ?? BROKEN;
}

/** Downloads a file response through the page, so an outage answer can be shown instead of navigating to it. */
export async function download(path: string): Promise<ApiResult<null>> {
  let response: Response;
  try {
    response = await send(path, {});
  } catch {
    return { ok: false, status: 0, error: null };
  }
  noteServerClock(response);
  if (response.status === 401) sessionAnswered401(false);
  if (!response.ok) {
    const parsed = (await response.json().catch(() => null)) as ApiErrorBody | null;
    return { ok: false, status: response.status, error: parsed?.error ?? { code: "internal", message: "" } };
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "download";
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { ok: true, status: 200, data: null };
}
