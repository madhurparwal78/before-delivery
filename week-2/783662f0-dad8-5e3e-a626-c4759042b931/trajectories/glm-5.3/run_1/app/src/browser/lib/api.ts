/** API client: JSON in, errors out, ETags along. */

export interface ApiFailure {
  error: string;
  message: string;
  fields?: Record<string, string>;
  etag?: string;
}

export class ApiError extends Error {
  constructor(public readonly failure: ApiFailure, public readonly status: number) {
    super(failure.message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; etag?: string; idempotencyKey?: string } = {}): Promise<{ data: T; etag: string | null }> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.etag !== undefined) headers["If-Match"] = options.etag;
  if (options.idempotencyKey !== undefined) headers["Idempotency-Key"] = options.idempotencyKey;
  const res = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const etag = res.headers.get("etag");
  if (res.status === 204) return { data: null as T, etag };
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text === "" ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const failure = (parsed ?? { error: "unknown", message: "Something went wrong." }) as ApiFailure;
    throw new ApiError(failure, res.status);
  }
  return { data: parsed as T, etag };
}

export function fieldOf(err: unknown, field: string): string | undefined {
  if (err instanceof ApiError) return err.failure.fields?.[field];
  return undefined;
}

export function errorFields(err: unknown): Record<string, string> {
  if (err instanceof ApiError) return err.failure.fields ?? {};
  return {};
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.failure.message;
  return "Something went wrong.";
}

export function errorCode(err: unknown): string | null {
  if (err instanceof ApiError) return err.failure.error;
  return null;
}
