interface ApiErrorBody {
  code: string;
  message: string;
  [extra: string]: unknown;
}

/** A refusal from the server in the brief's error shape; anything else is thrown as a plain Error. */
export class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }

  get code(): string {
    return this.body.code;
  }
}

export const UNEXPECTED = "Something went wrong. Try again.";

type Options = { method?: string; body?: unknown; raw?: Blob | ArrayBuffer; contentType?: string; headers?: Record<string, string> };

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined;
  if (options.raw !== undefined) {
    body = options.raw;
    headers["Content-Type"] = options.contentType ?? "application/octet-stream";
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers["Content-Type"] = "application/json";
  }
  let response: Response;
  try {
    response = await fetch(path, { method: options.method ?? "GET", headers, body, credentials: "same-origin" });
  } catch {
    throw new Error(UNEXPECTED);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let parsed: unknown = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/api/auth/")) window.location.assign("/sign-in");
    const error = (parsed as { error?: ApiErrorBody } | undefined)?.error;
    throw error ? new Refusal(response.status, error) : new Error(UNEXPECTED);
  }
  return parsed as T;
}

export function newKey(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
