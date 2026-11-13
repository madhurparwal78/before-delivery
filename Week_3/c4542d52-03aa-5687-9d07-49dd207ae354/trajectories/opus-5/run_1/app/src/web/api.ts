import type { ApiErrorBody } from "../shared/types.js";

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.status = status;
    this.code = body.error.code;
    this.fields = body.fields ?? {};
    this.body = body;
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { ...options.headers };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(path, { method, headers, body, credentials: "same-origin" });
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => ({
    error: { code: "server_error", message: "Something went wrong on our side. Your register has not changed." },
  }));
  if (!response.ok) throw new ApiFailure(response.status, payload as ApiErrorBody);
  return payload as T;
}
