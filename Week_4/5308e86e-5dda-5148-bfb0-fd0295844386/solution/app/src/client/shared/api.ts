/** Requests to the API with the session token. A request after the session ended is never sent. */
import { ending, onSessionEnd, revoke, storedToken } from "./session.js";

/** The session ended while this request was in flight or before it started: callers just stop. */
export class SignedOut extends Error {}
/** The server answered 503 or could not be reached. */
export class Unreachable extends Error {}
/** The server answered 500. */
export class ServerFault extends Error {}

const inFlight = new Set<AbortController>();
onSessionEnd(() => {
  for (const controller of inFlight) controller.abort();
  inFlight.clear();
});

interface ApiOptions {
  body?: unknown;
  key?: string;
  /** Returns the response body as text instead of JSON. */
  text?: boolean;
}

interface ApiResult<T> {
  status: number;
  data: T;
  headers: Headers;
}

export async function api<T = any>(method: string, path: string, options: ApiOptions = {}): Promise<ApiResult<T>> {
  if (ending.ended) throw new SignedOut();
  const controller = new AbortController();
  inFlight.add(controller);
  const headers: Record<string, string> = { Authorization: `Bearer ${storedToken() ?? ""}` };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.key) headers["Idempotency-Key"] = options.key;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    inFlight.delete(controller);
    if (ending.ended) throw new SignedOut();
    throw new Unreachable();
  }
  inFlight.delete(controller);
  if (ending.ended) throw new SignedOut();
  if (response.status === 401) {
    revoke();
    throw new SignedOut();
  }
  if (response.status === 503) throw new Unreachable();
  if (response.status >= 500) throw new ServerFault();
  const raw = await response.text();
  if (ending.ended) throw new SignedOut();
  let data: unknown = raw;
  if (!options.text) data = raw === "" ? null : JSON.parse(raw);
  return { status: response.status, data: data as T, headers: response.headers };
}
