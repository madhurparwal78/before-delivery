import type { ApiErrorBody } from "../../shared/api";

/** A non-2xx API answer, carrying the published error body. */
export class ApiFail extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
  get code(): string {
    return this.body.error;
  }
  get fields(): Record<string, string> {
    return this.body.fields ?? {};
  }
}

interface Options {
  body?: unknown;
  key?: string;
  form?: FormData;
  signal?: AbortSignal;
}

const UNEXPECTED: ApiErrorBody = { error: "server_error", message: "Something went wrong on our side. Try again." };

async function request<T>(method: string, path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (options.key) headers["Idempotency-Key"] = options.key;
  const response = await fetch(path, { method, headers, body, credentials: "same-origin", signal: options.signal });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiFail(response.status, isErrorBody(parsed) ? parsed : UNEXPECTED);
  }
  return parsed as T;
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null && "error" in value && "message" in value;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, { signal }),
  post: <T>(path: string, body?: unknown, key?: string) => request<T>("POST", path, { body: body ?? {}, key }),
  put: <T>(path: string) => request<T>("PUT", path),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, { body }),
  delete: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData, key?: string) => request<T>("POST", path, { form, key }),
};

/** A fresh Idempotency-Key (8 to 128 characters). */
export function newKey(): string {
  return crypto.randomUUID();
}
