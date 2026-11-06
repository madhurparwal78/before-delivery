// The browser's only path to the server. It turns every outcome into one of: an answer, an
// HttpError (any non-2xx the screen shows), NoAnswer (the connection gave no HTTP answer) or
// Interrupted (the session ended mid-action and the action was not resent). 401s follow the
// brief's Session end rules through the handlers the session provider binds.
import type { ErrorBody } from "../shared/api.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(`HTTP ${status}`);
  }

  get code(): string | undefined {
    return "error" in this.body ? this.body.error : undefined;
  }

  get fields(): Record<string, string> {
    return "errors" in this.body ? this.body.errors : {};
  }
}

export class NoAnswer extends Error {}
export class Interrupted extends Error {}

type SessionEnd = "access_revoked" | "unauthenticated" | "session_expired";

interface SessionHandlers {
  /** Opens Sign in again (once for every concurrent caller) and resolves after a successful sign-in. */
  expired: () => Promise<void>;
  /** Leaves the screen for sign-in. `firstLoad` keeps the return address. */
  ended: (code: SessionEnd, firstLoad: boolean) => void;
}

let handlers: SessionHandlers | null = null;

export function bindSession(next: SessionHandlers): void {
  handlers = next;
}

/** Leaves the screen for sign-in after its first load (revoked or signed-out session). */
export function endSession(code: Exclude<SessionEnd, "session_expired">): void {
  handlers?.ended(code, false);
}

export function signInAgain(): Promise<void> {
  return handlers ? handlers.expired() : Promise.resolve();
}

interface Call {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  ifMatch?: number;
  /** The screen's first read: any 401 leaves for sign-in with the return address. */
  firstLoad?: boolean;
}

interface Answer<T> {
  status: number;
  data: T;
  etag: string | null;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? (JSON.parse(text) as unknown) : {};
}

/** Classifies a 401 the session provider must act on. Returns the code. */
export function sessionEndOf(status: number, body: unknown): SessionEnd | null {
  if (status !== 401 || typeof body !== "object" || body === null || !("error" in body)) return null;
  const code = (body as { error: unknown }).error;
  return code === "access_revoked" || code === "session_expired" || code === "unauthenticated" ? code : null;
}

export async function request<T>(path: string, call: Call = {}): Promise<Answer<T>> {
  const method = call.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  // One body string per call, so a resend after Sign in again is byte for byte the same.
  const payload = method === "GET" ? undefined : JSON.stringify(call.body ?? {});
  if (payload !== undefined) headers["Content-Type"] = "application/json";
  if (call.idempotencyKey) headers["Idempotency-Key"] = call.idempotencyKey;
  if (call.ifMatch !== undefined) headers["If-Match"] = `"${call.ifMatch}"`;

  const send = async (): Promise<{ response: Response; body: unknown }> => {
    let response: Response;
    try {
      response = await fetch(path, { method, headers, body: payload, credentials: "same-origin" });
    } catch {
      throw new NoAnswer();
    }
    let body: unknown;
    try {
      body = await parse(response);
    } catch {
      throw new NoAnswer();
    }
    return { response, body };
  };

  let { response, body } = await send();
  const end = sessionEndOf(response.status, body);
  if (end) {
    if (call.firstLoad || end !== "session_expired") {
      handlers?.ended(end, call.firstLoad === true);
      throw new HttpError(response.status, body as ErrorBody);
    }
    await signInAgain();
    if (!call.idempotencyKey) throw new Interrupted();
    ({ response, body } = await send());
  }
  if (!response.ok) throw new HttpError(response.status, body as ErrorBody);
  return { status: response.status, data: body as T, etag: response.headers.get("ETag") };
}

export async function get<T>(path: string, firstLoad = false): Promise<T> {
  return (await request<T>(path, { firstLoad })).data;
}

/** A form's field errors, or an empty record. */
export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof HttpError && error.status === 422 ? error.fields : {};
}

export function errorCode(error: unknown): string | undefined {
  return error instanceof HttpError ? error.code : undefined;
}
