// Same-origin JSON calls to /api. Every refusal arrives as an ApiError carrying the server's error body.
interface ErrorBody {
  error?: string;
  fields?: Record<string, string>;
  missing?: number[];
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: ErrorBody) {
    super(body.error ?? `HTTP ${status}`);
  }

  get code(): string {
    return this.body.error ?? "";
  }
}

let onSignedOut: () => void = () => undefined;

export function whenSignedOut(handler: () => void): void {
  onSignedOut = handler;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The refusal body, read field by field: anything the server did not send as the right type is left out. */
function errorBody(body: unknown): ErrorBody {
  if (!isRecord(body)) return {};
  const out: ErrorBody = {};
  if (typeof body.error === "string") out.error = body.error;
  if (isRecord(body.fields)) {
    out.fields = Object.fromEntries(Object.entries(body.fields).filter((e): e is [string, string] => typeof e[1] === "string"));
  }
  if (Array.isArray(body.missing)) out.missing = body.missing.filter((n): n is number => typeof n === "number");
  return out;
}

/** One call; the answer stays `unknown` (no body on 204) until a caller narrows it. */
async function send(method: string, path: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetch(path, { method, credentials: "same-origin", ...init });
  } catch {
    throw new ApiError(0, { error: "network" });
  }
  if (response.status === 204) return { status: 204, body: undefined };
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = new ApiError(response.status, errorBody(body));
    if (response.status === 401 && error.code === "unauthenticated") onSignedOut();
    throw error;
  }
  return { status: response.status, body };
}

/** A call answered with a JSON object; a missing, null or non-object answer is refused here, never handed on. */
async function sendObject<T extends object>(method: string, path: string, init: RequestInit): Promise<T> {
  const { status, body } = await send(method, path, init);
  if (!isRecord(body)) throw new ApiError(status, { error: "bad_response" });
  return body as T;
}

function jsonInit(body: unknown, headers: Record<string, string>): RequestInit {
  return body === undefined ? { headers } : {
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

export function api<T extends object>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  return sendObject<T>(method, path, jsonInit(body, headers));
}

/** A call whose answer the caller does not read (a 204, or a body it has no use for). */
export async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<void> {
  await send(method, path, jsonInit(body, headers));
}

export function putBytes<T extends object>(path: string, bytes: Blob): Promise<T> {
  return sendObject<T>("PUT", path, { headers: { "content-type": "application/octet-stream" }, body: bytes });
}

export function query(params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== "") search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** A random idempotency key; getRandomValues works on plain-http origins too. */
export function newKey(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
