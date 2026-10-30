// How the screens call the JSON API: same-origin JSON (or multipart) requests with the session cookie.

interface ApiFailure {
  code: string;
  message: string;
  fields: Record<string, string>;
}

type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiFailure };

/** The request never got an answer (offline, aborted, timed out, or the server could not answer). */
export class NetworkError extends Error {}

interface Options {
  json?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
}

export async function api<T>(method: string, path: string, options: Options = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: "same-origin" });
  } catch {
    throw new NetworkError("No answer from Teamseat");
  }
  if (response.status >= 500 && response.status !== 503) throw new NetworkError(`Teamseat answered ${response.status}`);
  if (response.status === 204) return { ok: true, status: 204, data: undefined as T };
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new NetworkError("Teamseat sent an unreadable answer");
  }
  if (response.ok) return { ok: true, status: response.status, data: payload as T };
  const error = (payload as { error?: Partial<ApiFailure> }).error ?? {};
  return {
    ok: false,
    status: response.status,
    error: { code: error.code ?? "unknown", message: error.message ?? "", fields: error.fields ?? {} },
  };
}

/** A fresh idempotency key made of printable ASCII (works on any origin, secure or not). */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `req-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
