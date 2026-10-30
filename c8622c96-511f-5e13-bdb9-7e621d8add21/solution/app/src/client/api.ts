// Same-origin JSON calls. Network failures are distinct from HTTP answers, because a claim or buy with no
// answer keeps its idempotency key.

export interface ApiErrorBody {
  code: string;
  message: string;
  fields?: Record<string, string>;
  [extra: string]: unknown;
}

export class Answer<T> {
  constructor(readonly status: number, readonly data: T | null, readonly error: ApiErrorBody | null,
    readonly headers: Headers) {}

  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }
}

export class NoAnswer extends Error {}

export const DATABASE_DOWN = "Saltprint Desk can't reach its records right now. Nothing was saved; try again shortly.";
export const NETWORK_DOWN = "Couldn't reach Saltprint Desk. Nothing was changed; try again.";

let onUnauthenticated: () => void = () => undefined;
export function whenSignedOut(handler: () => void): void {
  onUnauthenticated = handler;
}

export async function call<T>(method: string, path: string, body?: unknown | FormData,
  headers: Record<string, string> = {}): Promise<Answer<T>> {
  const init: RequestInit = { method, headers: { Accept: "application/json", ...headers }, credentials: "same-origin" };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new NoAnswer("no answer");
  }
  let parsed: unknown = null;
  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    parsed = await response.json().catch(() => null);
  }
  if (response.ok) return new Answer<T>(response.status, parsed as T, null, response.headers);
  const error = (parsed as { error?: ApiErrorBody } | null)?.error
    ?? { code: "http_error", message: `Saltprint Desk answered ${response.status}.` };
  if (response.status === 401 && path !== "/api/session") onUnauthenticated();
  return new Answer<T>(response.status, null, error, response.headers);
}

export const get = <T>(path: string): Promise<Answer<T>> => call<T>("GET", path);

/** The one sentence to show for a refused or failed action that has no copy of its own. */
export function failureText(answer: Answer<unknown> | null): string {
  if (answer === null) return NETWORK_DOWN;
  if (answer.status === 503 && answer.error?.code === "database_unavailable") return DATABASE_DOWN;
  return answer.error?.message ?? NETWORK_DOWN;
}

/** Runs an action; a network failure resolves to null instead of throwing. */
export async function attempt<T>(work: () => Promise<Answer<T>>): Promise<Answer<T> | null> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof NoAnswer) return null;
    throw error;
  }
}
