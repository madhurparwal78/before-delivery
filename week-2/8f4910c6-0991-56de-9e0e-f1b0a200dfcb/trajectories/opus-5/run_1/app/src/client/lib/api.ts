import type { ApiErrorBody } from '../../shared/types.js';

export type ApiResult<T> = {
  status: number;
  body: T | null;
  error: ApiErrorBody | null;
  headers: Headers;
};

export type CallOptions = {
  body?: unknown;
  idempotencyKey?: string;
  headers?: Record<string, string>;
};

export async function call<T>(method: string, path: string, options: CallOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let payload: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  const response = await fetch(path, { method, headers, body: payload });
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  const ok = response.status < 400;
  return {
    status: response.status,
    body: ok ? (parsed as T) : null,
    error: ok ? null : ((parsed ?? { error: 'server_error' }) as ApiErrorBody),
    headers: response.headers,
  };
}

export async function upload<T>(
  method: string,
  path: string,
  file: File,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(path, { method, headers, body: form });
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  const ok = response.status < 400;
  return {
    status: response.status,
    body: ok ? (parsed as T) : null,
    error: ok ? null : ((parsed ?? { error: 'server_error' }) as ApiErrorBody),
    headers: response.headers,
  };
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
