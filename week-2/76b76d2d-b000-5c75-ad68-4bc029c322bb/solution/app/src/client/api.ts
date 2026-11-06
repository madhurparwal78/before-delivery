import type { ApiErrorBody } from "../shared/api.ts";
import type { Locale } from "../shared/domain.ts";

export type ApiError = ApiErrorBody["error"] & { status: number };
export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiError };

let pageLocale: Locale = "en";

/** The page locale every API call reports in `X-Halide-Locale` (brief: API). */
export function setApiLocale(locale: Locale): void {
  pageLocale = locale;
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null && "error" in value;
}

export async function api<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  const init: RequestInit = { method, credentials: "same-origin", headers: { "X-Halide-Locale": pageLocale, ...headers } };
  if (method !== "GET") {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(body ?? {});
  }
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    return { ok: false, status: 0, error: { status: 0, code: "network", message: "" } };
  }
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  if (isErrorBody(parsed)) return { ok: false, status: response.status, error: { ...parsed.error, status: response.status } };
  return { ok: false, status: response.status, error: { status: response.status, code: "unknown", message: "" } };
}

/** One retry key per page visit for checkout and gift purchase (brief: Holding and checkout). */
export function newIdempotencyKey(): string {
  return `halide-${crypto.randomUUID()}`;
}
