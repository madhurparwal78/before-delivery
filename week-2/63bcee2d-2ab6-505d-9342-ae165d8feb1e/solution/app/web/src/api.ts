// The browser's one way to call the API. Every call resolves to a result; a missing response is
// `status: 0` (network failure), and error bodies keep the published shape.

export interface ErrorBody {
  error: string;
  errors?: Record<string, string>;
  [field: string]: unknown;
}

export type Result<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; body: ErrorBody };

interface CallOptions {
  idempotencyKey?: string;
  /** A FormData, Blob or string body sent as-is instead of JSON. */
  raw?: BodyInit;
  contentType?: string;
}

export async function call<T>(method: string, path: string, body?: unknown, options: CallOptions = {}): Promise<Result<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  let payload: BodyInit | undefined;
  if (options.raw !== undefined) {
    payload = options.raw;
    if (options.contentType) headers["Content-Type"] = options.contentType;
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: payload, credentials: "same-origin" });
  } catch {
    return { ok: false, status: 0, body: { error: "network" } };
  }
  const text = await response.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (response.ok) return { ok: true, status: response.status, data: json as T };
  const errorBody = json && typeof json === "object" && "error" in json ? (json as ErrorBody) : { error: `http_${response.status}` };
  return { ok: false, status: response.status, body: errorBody };
}

export const get = <T>(path: string): Promise<Result<T>> => call<T>("GET", path);
export const post = <T>(path: string, body: unknown = {}, options?: CallOptions): Promise<Result<T>> => call<T>("POST", path, body, options);
export const put = <T>(path: string, body: unknown = {}, options?: CallOptions): Promise<Result<T>> => call<T>("PUT", path, body, options);
export const patch = <T>(path: string, body: unknown, options?: CallOptions): Promise<Result<T>> => call<T>("PATCH", path, body, options);
export const del = <T>(path: string): Promise<Result<T>> => call<T>("DELETE", path);

/** A fresh idempotency key for one attempt at an action, reused by its retries. */
export const newRetryKey = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
