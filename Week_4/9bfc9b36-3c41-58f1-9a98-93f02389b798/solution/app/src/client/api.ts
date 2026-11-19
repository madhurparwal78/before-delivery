/** The one request path: it adds the bearer token, shares a single session refresh between refused writes, and repeats them once. */
import { OUTAGES } from "../shared/copy.js";
import type { ApiErrorBody, SessionBody } from "../shared/types.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
    readonly headers: Headers,
  ) {
    super(body.message);
  }

  get code(): string {
    return this.body.error;
  }

  get fields(): Record<string, string> {
    return this.body.fields ?? {};
  }
}

let accessToken: string | null = null;
let refreshing: Promise<SessionBody | null> | null = null;
let onSessionLost: () => void = () => undefined;
let onStoreOutage: (copy: string | null) => void = () => undefined;

export const setSessionLostHandler = (handler: () => void): void => {
  onSessionLost = handler;
};
export const setOutageHandler = (handler: (copy: string | null) => void): void => {
  onStoreOutage = handler;
};
export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

async function parseBody(response: Response): Promise<ApiErrorBody> {
  try {
    return (await response.json()) as ApiErrorBody;
  } catch {
    return { error: "unknown", message: "" };
  }
}

const REFRESH_TRIES = 3;
const REFRESH_PAUSE_MS = 400;

/** One fresh token: null only when the server answers 401; a service that is briefly not answering is asked again, then reported as its own error. */
async function fetchSession(): Promise<SessionBody | null> {
  let failure: ApiError | null = null;
  for (let tries = 0; tries < REFRESH_TRIES; tries++) {
    if (tries > 0) await new Promise((resolve) => window.setTimeout(resolve, REFRESH_PAUSE_MS));
    try {
      const response = await fetch("/api/session", { headers: { accept: "application/json" } });
      if (response.status === 401) {
        // an unread body keeps the request open in the browser, so the page never settles
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      if (response.ok) {
        const body = (await response.json()) as SessionBody;
        accessToken = body.access_token;
        return body;
      }
      failure = new ApiError(response.status, await parseBody(response), response.headers);
    } catch {
      failure = new ApiError(503, { error: "identity_unavailable", message: OUTAGES.identity }, new Headers());
    }
  }
  throw failure;
}

/** GET /api/session, shared: several refused writes at the same moment make one call. */
export function refreshSession(): Promise<SessionBody | null> {
  refreshing ??= fetchSession().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

interface RequestOptions {
  body?: unknown;
  raw?: BodyInit;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function attempt(method: string, path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  let body: BodyInit | undefined = options.raw;
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  return fetch(path, { method, headers, body, signal: options.signal });
}

export async function request(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
  let response = await attempt(method, path, options);
  if (response.status === 401 && path !== "/api/session") {
    const fresh = await refreshSession();
    if (!fresh) {
      onSessionLost();
      throw new ApiError(401, await parseBody(response), response.headers);
    }
    await response.body?.cancel().catch(() => undefined);
    response = await attempt(method, path, options);
  }
  if (!response.ok) {
    const failure = new ApiError(response.status, await parseBody(response), response.headers);
    if (failure.code === "store_unavailable") onStoreOutage(failure.body.message);
    throw failure;
  }
  return response;
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return (await request("GET", path, { signal })).json() as Promise<T>;
}

export async function sendJson<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ data: T; status: number; headers: Headers }> {
  const response = await request(method, path, { body, headers });
  const data = response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  return { data, status: response.status, headers: response.headers };
}

export async function getBlob(path: string): Promise<Blob> {
  return (await request("GET", path)).blob();
}

/** Every page of a collection, following its cursor. */
export async function getAll<T>(path: string, cap = 40): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  const joiner = path.includes("?") ? "&" : "?";
  for (let pages = 0; pages < cap; pages++) {
    const page: { items: T[]; next_cursor: string | null } = await getJson(`${path}${joiner}limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    items.push(...page.items);
    cursor = page.next_cursor;
    if (!cursor) break;
  }
  return items;
}
