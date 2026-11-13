// The browser's only route to data: the app's own /api, same origin, cookie session.

import type { ApiErrorBody } from "../shared/api.js";
import { observeServerTime } from "./kitchen.js";

type Result<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ApiErrorBody; retryAfter: number | null }
  | { ok: false; status: 0; error: null; retryAfter: null };

const SERVER_CLOCKS = ["/api/kitchen", "/api/floor", "/api/door"];

type SessionEnded = () => void;
let onSessionEnded: SessionEnded = () => undefined;

export function whenSessionEnds(handler: SessionEnded): void {
  onSessionEnded = handler;
}

let userEpoch = 0;

/** Marks a change of user: every request still in flight from before is ignored completely when it answers. */
export function nextUserEpoch(): void {
  userEpoch++;
}

/** The check that discards a late response: its caller never hears of an answer sent under an earlier sign-in. */
const ignored = <T>(): Promise<Result<T>> => new Promise<Result<T>>(() => undefined);

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null && "error" in value && "message" in value;
}

function hasNow(value: unknown): value is { now: string } {
  return typeof value === "object" && value !== null && "now" in value && typeof value.now === "string";
}

export async function api<T>(method: "GET" | "POST" | "DELETE", path: string, options: { json?: unknown; form?: FormData; key?: string } = {}): Promise<Result<T>> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.form) {
    body = options.form;
  }
  if (options.key) headers["Idempotency-Key"] = options.key;
  const sentIn = userEpoch;
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: "same-origin" });
  } catch {
    return sentIn === userEpoch ? { ok: false, status: 0, error: null, retryAfter: null } : ignored();
  }
  const parsed: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (sentIn !== userEpoch) return ignored();
  if (response.ok) {
    if (SERVER_CLOCKS.some((clock) => path.startsWith(clock)) && hasNow(parsed)) observeServerTime(parsed.now);
    return { ok: true, status: response.status, data: parsed as T };
  }
  if (!isErrorBody(parsed)) return { ok: false, status: 0, error: null, retryAfter: null };
  if (response.status === 401 && parsed.error === "unauthenticated") onSessionEnded();
  const retry = Number(response.headers.get("Retry-After"));
  return { ok: false, status: response.status, error: parsed, retryAfter: Number.isInteger(retry) && retry > 0 ? retry : null };
}

export function newKey(): string {
  return crypto.randomUUID();
}
