// Same-origin JSON calls. Every failure arrives as an ApiFailure carrying the API's error body.
import type { ApiErrorBody } from "../../shared/api";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody | null,
  ) {
    super(body?.message ?? `request failed (${status})`);
  }

  get code(): string {
    return this.body?.error ?? (this.status === 0 ? "network" : "unknown");
  }
}

interface Options {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiFailure(0, null);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (!response.ok) throw new ApiFailure(response.status, parsed as ApiErrorBody | null);
  return parsed as T;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
