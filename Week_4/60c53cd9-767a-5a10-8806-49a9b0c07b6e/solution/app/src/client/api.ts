/** The browser's one door to the API: JSON in and out, the published error shape, and the server's clock offset. */
import type { ApiErrorBody } from "../shared/api-types.js";

/** Thrown when a request gets no HTTP response at all. */
export class NetworkError extends Error {}

export interface ApiResult<T> {
  readonly status: number;
  readonly ok: boolean;
  readonly body: T;
  readonly headers: Headers;
}

let offsetMs: number | null = null;

/** Offsets within this many milliseconds of the current one are Date-header rounding and network delay, not a clock change. */
const OFFSET_TOLERANCE_MS = 30_000;

/** The server's clock as the browser sees it: a response's Date header minus the browser clock at arrival. */
export const serverNow = (): number => Date.now() + (offsetMs ?? 0);

export const errorOf = (result: ApiResult<unknown>): ApiErrorBody["error"] | null => {
  const body = result.body as Partial<ApiErrorBody> | null;
  return !result.ok && body?.error ? body.error : null;
};

interface Options {
  readonly json?: unknown;
  /** A raw upload body and its type, for the view-photo upload. */
  readonly raw?: { readonly body: Blob; readonly type: string };
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
}

export const api = async <T = unknown>(method: string, path: string, options: Options = {}): Promise<ApiResult<T>> => {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        ...(options.json === undefined ? {} : { "content-type": "application/json" }),
        ...(options.raw ? { "content-type": options.raw.type } : {}),
        ...options.headers,
      },
      body: options.raw ? options.raw.body : options.json === undefined ? undefined : JSON.stringify(options.json),
      signal: options.signal ?? null,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new NetworkError("No response");
  }
  const date = response.headers.get("date");
  if (date) {
    const parsed = Date.parse(date);
    if (!Number.isNaN(parsed)) {
      const next = parsed - Date.now();
      if (offsetMs === null || Math.abs(next - offsetMs) > OFFSET_TOLERANCE_MS) offsetMs = next;
    }
  }
  const text = await response.text();
  let body: unknown = null;
  if (text !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: response.status, ok: response.ok, body: body as T, headers: response.headers };
};
