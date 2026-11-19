export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields: Record<string, string> = {}) {
    super(message);
  }
}

interface ErrorBody { error?: { code?: string; message?: string; fields?: Record<string, string> }; fields?: Record<string, string> }

type Hooks = { onSessionEnded: () => void; onSignedOut: () => void };
let hooks: Hooks = { onSessionEnded: () => undefined, onSignedOut: () => undefined };
export function setApiHooks(next: Hooks): void { hooks = next; }

interface Options { key?: string; quiet401?: boolean }

// Requests in flight, so a long-lived connection (the event stream) can wait until the page's own reads are done.
let inflight = 0;
let lastSettled = 0;
const settledWaiters = new Set<() => void>();

function settle(): void {
  inflight -= 1;
  lastSettled = performance.now();
  if (inflight === 0) settledWaiters.forEach((w) => w());
}

/** Calls `ready` once no API request has been in flight for `quietMs`; the returned function cancels. */
export function whenQuiet(quietMs: number, ready: () => void): () => void {
  let timer = 0;
  let done = false;
  const check = () => {
    window.clearTimeout(timer);
    if (done || inflight > 0) return;
    const wait = lastSettled + quietMs - performance.now();
    if (wait > 0) { timer = window.setTimeout(check, wait); return; }
    done = true;
    settledWaiters.delete(check);
    ready();
  };
  settledWaiters.add(check);
  check();
  return () => { done = true; window.clearTimeout(timer); settledWaiters.delete(check); };
}

async function api<T>(method: string, path: string, body?: unknown, options: Options = {}): Promise<T> {
  inflight += 1;
  try {
    return await send<T>(method, path, body, options);
  } finally {
    settle();
  }
}

async function send<T>(method: string, path: string, body: unknown, options: Options): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";
  if (options.key) headers["Idempotency-Key"] = options.key;
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "network", "The server could not be reached.");
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (response.ok) return parsed as T;
  const err = (parsed as ErrorBody | null)?.error;
  const error = new ApiError(response.status, err?.code ?? "error", err?.message ?? "Something went wrong.", err?.fields ?? (parsed as ErrorBody | null)?.fields ?? {});
  if (response.status === 401 && !options.quiet401) {
    if (error.code === "session_ended") hooks.onSessionEnded();
    else if (error.code === "signed_out") hooks.onSignedOut();
  }
  throw error;
}

export const get = <T,>(path: string, options?: Options) => api<T>("GET", path, undefined, options);
export const post = <T,>(path: string, body: unknown = {}, options?: Options) => api<T>("POST", path, body, options);
export const put = <T,>(path: string, body: unknown) => api<T>("PUT", path, body);
export const patch = <T,>(path: string, body: unknown) => api<T>("PATCH", path, body);
export const del = <T,>(path: string) => api<T>("DELETE", path);

export function newKey(): string {
  return crypto.randomUUID();
}
