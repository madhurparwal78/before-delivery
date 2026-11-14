import { syncServerClock } from "./clock";
import { currentPath, signInReturningTo } from "./draft";

/** An error answered by the API: one JSON shape with a stable code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const unreachable = "We could not reach the club. Check your connection and try again.";

interface CallOptions {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  key?: string;
  signal?: AbortSignal;
  /** The caller keeps its own draft before sending the person to sign-in when the session has ended. */
  handlesSessionEnd?: boolean;
}

function newKey(): string {
  return crypto.randomUUID();
}

export async function call<T>(path: string, options: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.key) headers["Idempotency-Key"] = options.key;
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "UNREACHABLE", unreachable);
  }
  syncServerClock(response.headers.get("Date"));
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      code?: string;
      message?: string;
      errors?: Record<string, string>;
    } | null;
    // A 401 on an action means the session ended elsewhere: sign in again and come back here, keeping nothing.
    if (response.status === 401 && options.method && options.method !== "GET" && !options.handlesSessionEnd) {
      signInReturningTo(currentPath());
    }
    throw new ApiError(response.status, body?.code ?? "ERROR", body?.message ?? unreachable, body?.errors ?? {});
  }
  return (await response.json()) as T;
}

/**
 * The Idempotency-Key of one button's action. A press repeats the last key only when the same request last answered
 * 503 or gave no answer at all; after any other answer the next press gets a fresh UUID.
 */
export class RequestKey {
  private key: string | null = null;
  private request = "";

  for(request: string): string {
    if (this.key === null || this.request !== request) {
      this.key = newKey();
      this.request = request;
    }
    return this.key;
  }

  settle(error: unknown): void {
    const retryable = error instanceof ApiError && (error.status === 503 || error.status === 0);
    if (!retryable) this.key = null;
  }
}

/** True for the 401 a request answers once the session has ended. */
export function sessionEnded(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : unreachable;
}

// ---- shapes ----

interface PersonRef {
  username: string;
  name: string;
}

export interface Share {
  position: number;
  player: PersonRef;
  amount_cents: number;
  status: "due" | "paid" | "void" | "covered";
}

export interface Booking {
  id: string;
  kind: "booking" | "match";
  status: "held" | "paid" | "released" | "checked-in" | "no-show" | "cancelled";
  court: number;
  start: string;
  start_utc: string;
  minutes: number;
  note: string;
  total_cents: number;
  organiser: PersonRef;
  shares: Share[];
  settle_at: string | null;
  created_at: string;
  expires_at: string | null;
  remaining_ms: number | null;
  server_now: string;
}

export interface Match {
  id: string;
  court: number;
  start: string;
  start_utc: string;
  minutes: number;
  level_min: number;
  level_max: number;
  status: "open" | "full" | "cancelled";
  players: number;
  share_cents: number;
  cutoff_at: string;
  joined: boolean;
  booking_id: string | null;
  server_now: string;
}

export interface Me {
  username: string;
  name: string;
  email: string;
  roles: string[];
  level: number | null;
  coach_id: string | null;
  push_topic: string | null;
}

export interface Club {
  timezone: string;
  hold_seconds: number;
  match_cutoff_seconds: number;
  free_cancel_seconds: number;
  share_settle_seconds: number;
  opening_hours: string;
  late_fee_percent: number;
  rule_description: string;
}

export interface Quote {
  total_cents: number;
  split_cents: number[];
  minutes: number;
}

export interface Paged<T> {
  items: T[];
  next_cursor: string | null;
}
