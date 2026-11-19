// The browser talks only to this app's own origin.
import type { ErrorBody } from "../shared/api.js";
import { syncServerClock } from "./serverClock.js";

interface Failure {
  status: number;
  code: string;
  message: string;
  fields: Record<string, string>;
}

type Outcome<Body> = { ok: true; status: number; body: Body } | { ok: false; failure: Failure };

type OutageListener = (dependency: "holds" | "deposits") => void;
const outageListeners = new Set<OutageListener>();
type SessionListener = () => void;
const sessionListeners = new Set<SessionListener>();

/** Any 503 from an action shows the matching banner at once, without waiting for the next status check. */
export function onOutage(listener: OutageListener): () => void {
  outageListeners.add(listener);
  return () => outageListeners.delete(listener);
}

/** The first 401 from a host request ends the host session in the page. */
export function onHostSessionEnded(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

function failureOf(status: number, body: ErrorBody | null): Failure {
  const error = body?.error;
  return { status, code: error?.code ?? "unknown", message: error?.message ?? "", fields: error?.fields ?? {} };
}

function newKey(): string {
  return crypto.randomUUID();
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  keyed?: boolean;
  signal?: AbortSignal;
  keepalive?: boolean;
  host?: boolean;
}

export async function request<Body>(path: string, options: RequestOptions = {}): Promise<Outcome<Body>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.keyed === true) headers["Idempotency-Key"] = newKey();
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      keepalive: options.keepalive,
    });
  } catch {
    return { ok: false, failure: { status: 0, code: "network", message: "", fields: {} } };
  }
  const text = await response.text();
  const parsed = text === "" ? null : JSON.parse(text);
  if (response.ok) {
    if (typeof parsed?.server_now === "string") syncServerClock(parsed.server_now);
    return { ok: true, status: response.status, body: parsed };
  }
  const failure = failureOf(response.status, parsed);
  if (failure.code === "holds_paused") for (const listener of outageListeners) listener("holds");
  if (failure.code === "deposits_paused") for (const listener of outageListeners) listener("deposits");
  if (options.host === true && failure.status === 401) for (const listener of sessionListeners) listener();
  return { ok: false, failure };
}

export function get<Body>(path: string, options: RequestOptions = {}): Promise<Outcome<Body>> {
  return request<Body>(path, options);
}

export function post<Body>(path: string, body: unknown, options: RequestOptions = {}): Promise<Outcome<Body>> {
  return request<Body>(path, { ...options, method: "POST", body });
}

export function del(path: string, options: RequestOptions = {}): Promise<Outcome<null>> {
  return request<null>(path, { ...options, method: "DELETE" });
}
