import type { ApiError } from "../../shared/types";

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly body: ApiError, readonly retryAfter: number | null) {
    super(body.message);
  }
}
/** The request got no answer (connection dropped, aborted by the network). */
export class LostRequest extends Error {}

interface CallOptions {
  signal?: AbortSignal;
  form?: FormData;
  /** do not run the ended-session / other-account handlers */
  quiet?: boolean;
}

type Guard = (status: number, error: string) => void;
let guard: Guard | null = null;
/** Signed-in screens register what to do when any request answers 401 or 403 forbidden. */
export function watchAuthorisation(fn: Guard | null): void {
  guard = fn;
}

export async function call<T>(method: string, path: string, body?: unknown, opts: CallOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      signal: opts.signal,
      headers: opts.form || body === undefined ? undefined : { "content-type": "application/json" },
      body: opts.form ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new LostRequest("no answer");
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text().catch(() => "");
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const error = (parsed ?? { error: "unknown", message: "Something went wrong." }) as ApiError;
    const header = Number(response.headers.get("retry-after"));
    const retry = typeof error["retryAfter"] === "number" ? (error["retryAfter"] as number) : header > 0 ? header : null;
    if (!opts.quiet && guard && (response.status === 401 || (response.status === 403 && error.error === "forbidden"))) guard(response.status, error.error);
    throw new ApiFailure(response.status, error, retry);
  }
  return parsed as T;
}

export const get = <T>(path: string, opts?: CallOptions): Promise<T> => call<T>("GET", path, undefined, opts);
export const post = <T>(path: string, body: unknown = {}, opts?: CallOptions): Promise<T> => call<T>("POST", path, body, opts);
export const put = <T>(path: string, body: unknown, opts?: CallOptions): Promise<T> => call<T>("PUT", path, body, opts);
export const patch = <T>(path: string, body: unknown, opts?: CallOptions): Promise<T> => call<T>("PATCH", path, body, opts);
export const del = <T>(path: string, opts?: CallOptions): Promise<T> => call<T>("DELETE", path, undefined, opts);

export const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === "AbortError";
export const messageOf = (e: unknown, lost: string): string => (e instanceof ApiFailure ? e.body.message : e instanceof LostRequest ? lost : "Something went wrong.");
