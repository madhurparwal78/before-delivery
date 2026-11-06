import type { ErrorBody } from "../shared/domain";

// The browser's only door to the server: same-origin JSON (or multipart) under /api.

/** The server answered with the API's error shape. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody & { unverified?: number },
  ) {
    super(body.message);
  }

  get code(): string {
    return this.body.error;
  }
}

/** The request never reached the server (offline, aborted, or the connection dropped). */
export class NetworkError extends Error {}

let onUnauthenticated: () => void = () => undefined;

/** Called whenever a request answers 401, so the app can return to the sign-in screen. */
export function whenSignedOut(handler: () => void): void {
  onUnauthenticated = handler;
}

async function call<T>(method: string, path: string, body: unknown, quietAuth: boolean): Promise<{ body: T; response: Response }> {
  const init: RequestInit = { method, credentials: "same-origin", headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new NetworkError("No connection");
  }
  if (response.status === 204) return { body: undefined as T, response };
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new NetworkError("Unreadable response");
  }
  if (!response.ok) {
    const failure = new ApiFailure(response.status, parsed as ErrorBody);
    if (failure.code === "unauthenticated" && !quietAuth) onUnauthenticated();
    throw failure;
  }
  return { body: parsed as T, response };
}

export async function api<T>(method: string, path: string, body?: unknown, options: { quietAuth?: boolean } = {}): Promise<T> {
  return (await call<T>(method, path, body, options.quietAuth ?? false)).body;
}

/** A GET that also answers the server's clock at the moment it replied, from the Date header. */
export async function apiWithServerTime<T>(path: string): Promise<{ body: T; serverTime: number }> {
  const { body, response } = await call<T>("GET", path, undefined, false);
  const header = Date.parse(response.headers.get("date") ?? "");
  return { body, serverTime: Number.isNaN(header) ? Date.now() : header };
}
