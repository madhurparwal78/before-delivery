// Fetch layer and data hooks.
//   api.get/post/put/patch/del<T>(path, body?, opts?)   JSON in, JSON out (a 204 answer resolves null). Errors are thrown as ApiError.
//     opts: { idempotencyKey?, signal?, headers?, contentType? }   (contentType sends a string body as-is, e.g. text/plain)
//   idempotencyKey()                a fresh key for the Idempotency-Key header
//   ApiError { status, code, message, details }   error body shape {error, message, details?}; fieldErrors() reads details.fields
//   pendingWrites / usePending()    number of non-GET requests in flight (drives <main data-pending>)
//   readsInFlight()                 number of GET requests in flight (main.tsx holds the window load event until the first ones answer)
//   busyProps(pending)              spread on a button: aria-busy="true" + disabled while pending, the label stays
//   useResource(load, deps)         { data, error, loading, reload, setData }; keeps data while reloading, clears on deps change
//   useAction(fn, { announce })     { run, pending, error }; run never throws, it returns undefined on failure and announces
//                                   the API message (disable with announce: false)
// A 401 (other than a refused sign-in) sends the browser to /sign-in?next=<path>. A `storage_unavailable` answer switches the
// instance status to the outage state.
import { useCallback, useLayoutEffect, useRef, useState } from "preact/hooks";
import { announce } from "./announce.tsx";
import { setStorage } from "./instance.ts";
import { navigate, currentLocation } from "./router.ts";
import { setUser } from "./session.ts";
import { createStore, useStore } from "./store.ts";
import { asString, isRecord, nextTick } from "./util.ts";

export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown> | undefined;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  fieldErrors(): Record<string, string> {
    const fields = this.details?.fields;
    if (!isRecord(fields)) return {};
    const out: Record<string, string> = {};
    for (const [name, text] of Object.entries(fields)) {
      if (typeof text === "string") out[name] = text;
    }
    return out;
  }
}

interface RequestOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  contentType?: string;
}

const pendingWrites = createStore(0);

export function usePending(): number {
  return useStore(pendingWrites);
}

let pendingReads = 0;

export function readsInFlight(): number {
  return pendingReads;
}

export function idempotencyKey(): string {
  return crypto.randomUUID();
}

function toApiError(status: number, text: string): ApiError {
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (isRecord(body)) {
    const details = isRecord(body.details) ? body.details : undefined;
    return new ApiError(status, asString(body.error) ?? `http_${status}`, asString(body.message) ?? "Something went wrong.", details);
  }
  return new ApiError(status, `http_${status}`, "Something went wrong.");
}

function leaveForSignIn(): void {
  const here = currentLocation();
  if (here.path === "/sign-in" || here.path === "/sign-up") return;
  setUser(null);
  navigate(`/sign-in?next=${encodeURIComponent(here.path + here.search)}`, { replace: true, force: true });
}

async function request<T>(method: string, path: string, body: unknown, opts: RequestOptions): Promise<T> {
  const write = method !== "GET";
  if (write) pendingWrites.update((n) => n + 1);
  else pendingReads++;
  try {
    const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
    let payload: string | undefined;
    if (body !== undefined) {
      if (opts.contentType !== undefined && typeof body === "string") {
        headers["Content-Type"] = opts.contentType;
        payload = body;
      } else {
        headers["Content-Type"] = "application/json";
        payload = JSON.stringify(body);
      }
    }
    if (opts.idempotencyKey !== undefined) headers["Idempotency-Key"] = opts.idempotencyKey;
    let response: Response;
    try {
      response = await fetch(path, { method, headers, body: payload, credentials: "same-origin", signal: opts.signal });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
      throw new ApiError(0, "network", "The server could not be reached.");
    }
    const text = response.status === 204 ? "" : await response.text();
    if (response.ok) return JSON.parse(text || "null");
    const error = toApiError(response.status, text);
    if (error.status === 401 && error.code !== "bad_credentials") leaveForSignIn();
    if (error.code === "storage_unavailable") setStorage("down");
    throw error;
  } finally {
    if (write) pendingWrites.update((n) => n - 1);
    else pendingReads--;
  }
}

export const api = {
  get: <T,>(path: string, opts: RequestOptions = {}) => request<T>("GET", path, undefined, opts),
  post: <T,>(path: string, body?: unknown, opts: RequestOptions = {}) => request<T>("POST", path, body, opts),
  put: <T,>(path: string, body?: unknown, opts: RequestOptions = {}) => request<T>("PUT", path, body, opts),
  patch: <T,>(path: string, body?: unknown, opts: RequestOptions = {}) => request<T>("PATCH", path, body, opts),
  del: <T,>(path: string, body?: unknown, opts: RequestOptions = {}) => request<T>("DELETE", path, body, opts),
};

export function asApiError(cause: unknown): ApiError {
  if (cause instanceof ApiError) return cause;
  return new ApiError(0, "client_error", cause instanceof Error ? cause.message : "Something went wrong.");
}
export interface Resource<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  /** Fetches again; resolves once the answer is applied (or failed). Overlapping calls share one follow-up request. */
  reload(): Promise<void>;
  /** Replaces the data without a request (optimistic updates). */
  setData(change: (current: T | undefined) => T): void;
  /** Tick (see live.ts) at which the latest request started. */
  startedTick(): number;
}

export type Loader<T> = (signal: AbortSignal) => Promise<T>;

interface ResourceState<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
}

export function useResource<T>(load: Loader<T>, deps: readonly unknown[] = []): Resource<T> {
  const [state, setState] = useState<ResourceState<T>>({ data: undefined, error: null, loading: true });
  const loadRef = useRef(load);
  loadRef.current = load;
  const run = useRef({
    generation: 0,
    running: false,
    queued: [] as Array<() => void>,
    controllers: new Set<AbortController>(),
    tick: 0,
    mounted: true,
  });

  const start = useCallback((waiters: Array<() => void>) => {
    const r = run.current;
    const generation = r.generation;
    r.running = true;
    r.tick = nextTick();
    const controller = new AbortController();
    r.controllers.add(controller);
    setState((s) => (s.loading ? s : { ...s, loading: true }));
    const finish = (next: ResourceState<T> | null) => {
      r.controllers.delete(controller);
      if (generation !== r.generation) return;
      if (next && r.mounted) setState(next);
      r.running = false;
      for (const done of waiters) done();
      if (r.queued.length > 0) {
        const queued = r.queued;
        r.queued = [];
        start(queued);
      }
    };
    loadRef.current(controller.signal).then(
      (data) => finish({ data, error: null, loading: false }),
      (cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return finish(null);
        finish({ data: undefined, error: asApiError(cause), loading: false });
      },
    );
  }, []);

  const reload = useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (run.current.running) run.current.queued.push(resolve);
        else start([resolve]);
      }),
    [start],
  );

  useLayoutEffect(() => {
    const r = run.current;
    r.mounted = true;
    r.generation++;
    for (const controller of r.controllers) controller.abort();
    r.controllers.clear();
    for (const done of [...r.queued]) done();
    r.queued = [];
    r.running = false;
    setState({ data: undefined, error: null, loading: true });
    start([]);
    return () => {
      r.mounted = false;
      r.generation++;
      for (const controller of r.controllers) controller.abort();
      r.controllers.clear();
    };
  }, deps);

  const setData = useCallback((change: (current: T | undefined) => T) => {
    setState((s) => ({ ...s, data: change(s.data) }));
  }, []);
  const startedTick = useCallback(() => run.current.tick, []);

  return { data: state.data, error: state.error, loading: state.loading, reload, setData, startedTick };
}

interface ActionOptions {
  announce?: boolean;
}

interface Action<A extends unknown[], R> {
  run(...args: A): Promise<R | undefined>;
  pending: boolean;
  error: ApiError | null;
}

export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, options: ActionOptions = {}): Action<A, R> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const announceErrors = options.announce !== false;
  const flags = useRef({ busy: false, mounted: true });
  useLayoutEffect(() => {
    flags.current.mounted = true;
    return () => {
      flags.current.mounted = false;
    };
  }, []);

  const runAction = useCallback(
    async (...args: A): Promise<R | undefined> => {
      if (flags.current.busy) return undefined;
      flags.current.busy = true;
      setPending(true);
      setError(null);
      try {
        return await fnRef.current(...args);
      } catch (cause) {
        const failure = asApiError(cause);
        if (flags.current.mounted) setError(failure);
        if (announceErrors && failure.code !== "unauthenticated") announce(failure.message, "error");
        return undefined;
      } finally {
        flags.current.busy = false;
        if (flags.current.mounted) setPending(false);
      }
    },
    [announceErrors],
  );
  return { run: runAction, pending, error };
}
