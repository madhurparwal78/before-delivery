import type { ApiFailure } from "../shared/api";

export type Blocker = NonNullable<ApiFailure["blockers"]>[number];

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; errors: Record<string, string>; blockers: Blocker[] };

const UNREACHABLE = "The server could not be reached.";

/** One JSON call. Refusals come back as values so the caller shows the server's own words. */
export async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Result<T>> {
  try {
    const answer = await fetch(path, {
      method,
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
    if (answer.status === 401 && path !== "/api/session") {
      window.location.assign("/");
    }
    const text = await answer.text();
    const parsed: unknown = text ? JSON.parse(text) : null;
    if (answer.ok) return { ok: true, data: parsed as T };
    const failure = (parsed ?? {}) as ApiFailure;
    return { ok: false, status: answer.status, error: failure.error ?? "", errors: failure.errors ?? {}, blockers: failure.blockers ?? [] };
  } catch {
    return { ok: false, status: 0, error: UNREACHABLE, errors: {}, blockers: [] };
  }
}

export const get = <T>(path: string) => call<T>("GET", path);
export const post = <T>(path: string, body?: unknown, headers?: Record<string, string>) => call<T>("POST", path, body ?? {}, headers);

/** The sentence a refusal shows: its own error text, else the first field message. */
export function refusalText(failure: { error: string; errors: Record<string, string> }): string {
  return failure.error || Object.values(failure.errors)[0] || "";
}

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
