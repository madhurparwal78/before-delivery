import type { ApiErrorBody } from "../../shared/types";

type Reply<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiErrorBody };

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  /** Lets the request finish even if the page closes straight after it is sent. */
  keepalive?: boolean;
}

/** Calls the app's own API. Network failures come back as status 0 so callers show their outage copy. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<Reply<T>> {
  const isForm = options.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(options.body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      body: options.body === undefined ? null : isForm ? (options.body as FormData) : JSON.stringify(options.body),
      keepalive: options.keepalive ?? false,
    });
  } catch {
    return { ok: false, status: 0, error: { error: "network" } };
  }
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : undefined;
  return response.ok
    ? { ok: true, status: response.status, data: parsed as T }
    : { ok: false, status: response.status, error: (parsed as ApiErrorBody | undefined) ?? { error: "unknown" } };
}

export function newRequestKey(): string {
  return crypto.randomUUID();
}
