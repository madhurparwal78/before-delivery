// The browser's only door to the server: same origin, the bearer token on every request, and every refusal turned
// into one typed failure whose message is shown verbatim.

import { NETWORK_FAILURE } from "../shared/copy.ts";

export type Failure =
  | { kind: "network" }
  | { kind: "error"; status: number; code: string; message: string }
  | { kind: "fields"; errors: Record<string, string> };

class ApiFailure extends Error {
  constructor(readonly failure: Failure) {
    super(failure.kind);
  }
}

let token: string | null = null;

export function setToken(next: string | null): void {
  token = next;
}

interface Answer<T> {
  body: T;
  headers: Headers;
}

/** Sends a request and returns the body with the response headers (the risk form reads the ETag). */
export async function request<T>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  options: { body?: unknown; idempotencyKey?: string; headers?: Record<string, string> } = {},
): Promise<Answer<T>> {
  const headers: Record<string, string> = { ...options.headers };
  if (token !== null) headers["Authorization"] = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.idempotencyKey !== undefined) headers["Idempotency-Key"] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: options.body === undefined ? null : JSON.stringify(options.body) });
  } catch {
    throw new ApiFailure({ kind: "network" });
  }
  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return { body: payload as T, headers: response.headers };
  const problem = payload !== null && typeof payload === "object" ? (payload as { code?: string; detail?: string; errors?: Record<string, string> }) : {};
  if (response.status === 422 && problem.errors) throw new ApiFailure({ kind: "fields", errors: problem.errors });
  throw new ApiFailure({ kind: "error", status: response.status, code: problem.code ?? "", message: problem.detail ?? NETWORK_FAILURE });
}

export async function api<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  return (await request<T>(method, path, { body, idempotencyKey })).body;
}

/** A stored PDF as a blob, fetched with the bearer token because the browser never uses cookies. */
export async function download(path: string): Promise<Blob> {
  const headers: Record<string, string> = token === null ? {} : { Authorization: `Bearer ${token}` };
  let response: Response;
  try {
    response = await fetch(path, { headers });
  } catch {
    throw new ApiFailure({ kind: "network" });
  }
  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as { code?: string; detail?: string } | null;
    throw new ApiFailure({ kind: "error", status: response.status, code: problem?.code ?? "", message: problem?.detail ?? NETWORK_FAILURE });
  }
  return response.blob();
}

export function failureOf(error: unknown): Failure {
  return error instanceof ApiFailure ? error.failure : { kind: "network" };
}

export function newKey(): string {
  return crypto.randomUUID();
}

/**
 * Keeps one Idempotency-Key per request body for the buttons that retry by being pressed again: pressing the same
 * button with unchanged inputs resends the same key, so the server answers with the original response, and any
 * change to the inputs starts a new key.
 */
export class RetryKey {
  private body = "";
  private key = "";

  forBody(body: unknown): string {
    const text = JSON.stringify(body);
    if (text !== this.body) {
      this.body = text;
      this.key = newKey();
    }
    return this.key;
  }
}
