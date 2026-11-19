import type { ApiErrorBody } from '../../shared/types';

export class ApiFailure extends Error {
  readonly status: number;

  readonly code: string;

  readonly fields: Record<string, string>;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error.message ?? 'Request failed');
    this.name = 'ApiFailure';
    this.status = status;
    this.code = body?.error.code ?? 'request_failed';
    this.fields = body?.error.fields ?? {};
  }
}

let clockOffsetMs = 0;

/** Keeps the browser's countdowns on the server's clock, whatever the device clock says. */
export function recordServerNow(serverNow: string | undefined): void {
  if (!serverNow) return;
  const parsed = Date.parse(serverNow);
  if (Number.isNaN(parsed)) return;
  clockOffsetMs = parsed - Date.now();
}

export function serverNowMs(): number {
  return Date.now() + clockOffsetMs;
}

async function request<T>(
  method: string,
  path: string,
  options: {
    body?: unknown;
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text.length > 0 ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    throw new ApiFailure(response.status, parsed as ApiErrorBody | null);
  }
  const value = parsed as T & { server_now?: string };
  recordServerNow(value?.server_now);
  return value;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>('GET', path);
}

export function apiPost<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
  return request<T>('POST', path, idempotencyKey ? { body, idempotencyKey } : { body });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>('DELETE', path);
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>('PUT', path, { body });
}

/** Releases a hold in a way that survives the page unload. */
export function releaseHoldOnUnload(holdId: string): void {
  void fetch(`/api/holds/${holdId}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    keepalive: true,
  }).catch(() => undefined);
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
