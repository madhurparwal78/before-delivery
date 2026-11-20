import type { ApiErrorBody, Ride } from "../../shared/api";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly ride: Ride | undefined;

  constructor(status: number, body: Partial<ApiErrorBody>) {
    super(body.message ?? "Something went wrong. Try again.");
    this.status = status;
    this.code = body.error ?? "unknown";
    this.fields = body.fields ?? {};
    this.ride = body.ride;
  }
}

interface Options {
  body?: unknown;
  key?: string;
  headers?: Record<string, string>;
  form?: FormData;
}

export async function api<T>(method: string, path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.key) headers["Idempotency-Key"] = options.key;
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, { error: "network", message: "We could not reach the server. Try again." });
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) throw new ApiError(response.status, (parsed ?? {}) as Partial<ApiErrorBody>);
  return parsed as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Try again.";
}

/** One random key per button press. */
export function newKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
