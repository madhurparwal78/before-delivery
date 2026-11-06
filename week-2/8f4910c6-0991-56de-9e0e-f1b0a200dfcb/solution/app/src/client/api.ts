// JSON API client. Every call resolves (never throws for HTTP errors) to a tagged result.
// A 401 that means the session is gone is also reported to the session module.

export interface ApiErrorBody {
  error: string;
  errors?: Record<string, string>;
  [key: string]: unknown;
}

export type ApiResult<T> =
  | { ok: true; status: number; data: T; headers: Headers }
  | { ok: false; status: number; error: ApiErrorBody; headers: Headers };

export interface ApiInit {
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

type SessionListener = (code: "session_ended" | "access_removed") => void;
let sessionListener: SessionListener | null = null;

/** The session module registers here to hear about ended sessions. */
export function onSessionProblem(listener: SessionListener): void {
  sessionListener = listener;
}

const SESSION_CODES = new Set(["session_ended", "unauthenticated", "access_removed"]);

export async function api<T>(method: string, path: string, body?: unknown, init: ApiInit = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: "application/json", ...init.headers };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: payload, credentials: "same-origin" });
  } catch {
    return { ok: false, status: 0, error: { error: "network" }, headers: new Headers() };
  }
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (response.ok) return { ok: true, status: response.status, data: parsed as T, headers: response.headers };
  const error: ApiErrorBody =
    parsed && typeof parsed === "object" && "error" in parsed ? (parsed as ApiErrorBody) : { error: `http_${response.status}` };
  if (response.status === 401 && SESSION_CODES.has(error.error) && sessionListener) {
    sessionListener(error.error === "access_removed" ? "access_removed" : "session_ended");
  }
  return { ok: false, status: response.status, error, headers: response.headers };
}

/** A fresh idempotency key for one logical write. */
export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
