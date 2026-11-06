// Same-origin calls to the Passboard API, and the server clock as seen from the browser.

import type { ErrorBody } from "../shared/api.js";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(body.error);
  }
}

/** The request never got an answer. */
export class Unreachable extends Error {}

let onSessionEnded: () => void = () => undefined;

export function whenSessionEnds(handler: () => void): void {
  onSessionEnded = handler;
}

let serverOffsetMs = 0;

/** Remembers the server's now as an offset from the browser clock; never the browser's zone or date. */
export function syncServerClock(serverNow: string): void {
  serverOffsetMs = Date.parse(serverNow) - Date.now();
}

/** The server's now in epoch milliseconds, advanced by the browser's monotonic tick since the last sync. */
export function serverNow(): number {
  return Date.now() + serverOffsetMs;
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

export async function call<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined || body instanceof FormData ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new Unreachable("no response");
  }
  if (response.status === 204) return undefined as T;
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  if (response.ok) return parsed as T;
  const failure = new ApiFailure(response.status, (parsed as ErrorBody | null) ?? { error: `http_${response.status}` });
  if (response.status === 401 && path !== "/api/session") onSessionEnded();
  throw failure;
}

export const get = <T>(path: string): Promise<T> => call<T>("GET", path);
export const post = <T>(path: string, body: unknown = {}): Promise<T> => call<T>("POST", path, body);
