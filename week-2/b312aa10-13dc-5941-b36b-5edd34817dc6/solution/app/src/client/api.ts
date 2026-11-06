// The browser talks only to the Lineboard server. Every error arrives in the brief's one shape.

import { NETWORK_COPY } from "../shared/copy.js";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown>,
    /** Whole seconds from a 429's Retry-After header. */
    readonly retryAfter: number | null = null,
  ) {
    super(message);
  }

  get fieldErrors(): Record<string, string> {
    return (this.body.errors as Record<string, string> | undefined) ?? {};
  }
}

/** Status 0: the server could not be reached. */
export const NETWORK = "network";

let lastServerMs = 0;

/** The server's clock as of the latest response (the browser's clock is never trusted for kitchen time). */
export function serverNow(): number {
  return lastServerMs;
}

let onUnauthenticated = (): void => undefined;

// ------------------------------------------------------------- session hand-over

/**
 * The browser's session epoch. Sign-out and a 401 end it: every request sent under it that has not
 * answered is aborted, and any answer that still arrives is never handed to a screen (its promise
 * never settles), so nothing from an earlier session is drawn, even after the next person signs in.
 */
let epoch = 0;
const inflight = new Set<AbortController>();
const abandoned = <T>(): Promise<T> => new Promise<T>(() => undefined);

export function endSession(): void {
  epoch += 1;
  ownPending = 0;
  for (const c of inflight) c.abort();
  inflight.clear();
}

/** Registers what every screen does on a 401 `unauthenticated`: return to sign in. */
export function whenUnauthenticated(fn: () => void): void {
  onUnauthenticated = fn;
}

interface Answer<T> { status: number; data: T; serverMs: number }

// ------------------------------------------------------------- own actions

/**
 * The person's own board actions (hold, confirm, discard, cancel, check-in, check-out, no-show,
 * move, release, window save): every POST under /api/bookings and the out-of-service save. A board
 * response is drawn only when its request was sent while none of them was in flight and none has
 * started since (Interactions › Refresh), so a late read never brings back an older board.
 */
let ownStarted = 0;
let ownPending = 0;
const isBoardAction = (method: string, path: string): boolean =>
  method === "POST" && (/^\/api\/bookings(\/|$)/.test(path) || path === "/api/out-of-service");

/** Call just before a board read is sent; the check says whether its response may be drawn. */
export function boardRead(): () => boolean {
  const at = ownStarted;
  const clean = ownPending === 0;
  return () => clean && ownStarted === at;
}

async function tracked<T>(method: string, path: string, work: () => Promise<T>): Promise<T> {
  if (!isBoardAction(method, path)) return work();
  const under = epoch;
  ownStarted += 1;
  ownPending += 1;
  try {
    return await work();
  } finally {
    // Counted as answered before the caller sees the answer, so its own follow-up read is drawn.
    // (A request abandoned at sign-out never settles; ending the session resets the count.)
    if (under === epoch) ownPending -= 1;
  }
}

/** Listeners told whenever one of the person's own state-changing requests has answered. */
const actionListeners = new Set<() => void>();
export function onOwnAction(listener: () => void): () => void {
  actionListeners.add(listener);
  return () => actionListeners.delete(listener);
}
const answered = (method: string, path: string): void => {
  if (method === "GET" || method === "HEAD" || path === "/api/session") return;
  for (const l of actionListeners) l();
};

async function send<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, sentUnder = epoch, track = true): Promise<Answer<T>> {
  if (sentUnder !== epoch) return abandoned();
  if (track) return tracked(method, path, () => send<T>(method, path, body, headers, sentUnder, false));
  const controller = new AbortController();
  inflight.add(controller);
  let response: Response;
  let text: string;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers: body === undefined || body instanceof FormData ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    text = await response.text();
  } catch {
    if (sentUnder !== epoch) return abandoned();
    throw new ApiFailure(0, NETWORK, NETWORK_COPY, {});
  } finally {
    inflight.delete(controller);
  }
  if (sentUnder !== epoch) return abandoned();
  const date = Date.parse(response.headers.get("date") ?? "");
  if (Number.isFinite(date)) lastServerMs = date;
  answered(method, path);
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // Not one of Lineboard's own answers: never shown raw.
    data = response.ok ? {} : { error: "internal" };
  }
  if (!response.ok) {
    if (data.error === "unauthenticated") {
      onUnauthenticated();
      if (sentUnder !== epoch) return abandoned();
    }
    const retry = Number(response.headers.get("retry-after"));
    throw new ApiFailure(response.status, String(data.error ?? "error"), String(data.message ?? ""), data, Number.isFinite(retry) && retry > 0 ? retry : null);
  }
  return { status: response.status, data: data as T, serverMs: lastServerMs };
}

export const get = <T>(path: string): Promise<Answer<T>> => send<T>("GET", path);
export const post = <T>(path: string, body: unknown = {}): Promise<Answer<T>> => send<T>("POST", path, body);
export const put = <T>(path: string, body: unknown): Promise<Answer<T>> => send<T>("PUT", path, body);
export const patch = <T>(path: string, body: unknown): Promise<Answer<T>> => send<T>("PATCH", path, body);
export const del = <T>(path: string): Promise<Answer<T>> => send<T>("DELETE", path);
export const upload = <T>(path: string, form: FormData): Promise<Answer<T>> => send<T>("POST", path, form);

const RETRY_DELAYS_MS = [1000, 3000, 6000];

/**
 * A retry-safe POST carrying a fresh Idempotency-Key for this user action: on a network failure the
 * same request and key are resent up to three times over about ten seconds.
 */
export async function postOnce<T>(path: string, body: unknown = {}): Promise<Answer<T>> {
  const key = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  // A retry is never sent under a later session than the one the action began in.
  const sentUnder = epoch;
  // One own action across its retries: no board read sent in between is drawn.
  return tracked("POST", path, async () => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send<T>("POST", path, body, { "Idempotency-Key": key }, sentUnder, false);
    } catch (error) {
      if (!(error instanceof ApiFailure) || error.code !== NETWORK || attempt === RETRY_DELAYS_MS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
  });
}
