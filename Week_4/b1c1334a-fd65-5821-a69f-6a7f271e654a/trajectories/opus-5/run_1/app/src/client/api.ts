import type { ApiErrorBody } from '../shared/api.js';

const TIMEOUT_MS = 10_000;

export type ApiResult<T> =
  | { ok: true; status: number; body: T; replayed: boolean }
  | { ok: false; status: number; body: ApiErrorBody | null; failed: boolean };

export type RequestSpec = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  idempotencyKey?: string;
};

export function newIdempotencyKey(): string {
  return `tf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function attempt<T>(spec: RequestSpec): Promise<ApiResult<T> | 'unreachable'> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(spec.path, {
      method: spec.method,
      headers: {
        'content-type': 'application/json',
        ...(spec.idempotencyKey === undefined
          ? {}
          : { 'idempotency-key': spec.idempotencyKey }),
      },
      body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
      signal: controller.signal,
      credentials: 'same-origin',
    });
    const text = await response.text();
    const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
    const parsed = text === '' ? null : isJson ? (JSON.parse(text) as unknown) : text;
    if (response.ok) {
      return {
        ok: true,
        status: response.status,
        body: parsed as T,
        replayed: response.headers.get('idempotent-replayed') === 'true',
      };
    }
    if (response.status >= 500) return 'unreachable';
    return {
      ok: false,
      status: response.status,
      body: parsed as ApiErrorBody | null,
      failed: false,
    };
  } catch {
    return 'unreachable';
  } finally {
    window.clearTimeout(timer);
  }
}

/** One resend with the same key, then the request counts as a connection failure. */
export async function send<T>(spec: RequestSpec): Promise<ApiResult<T>> {
  const first = await attempt<T>(spec);
  if (first !== 'unreachable') return first;
  const second = await attempt<T>(spec);
  if (second !== 'unreachable') return second;
  return { ok: false, status: 0, body: null, failed: true };
}

export function errorCode(result: ApiResult<unknown>): string | null {
  return result.ok ? null : (result.body?.error.code ?? null);
}

export function fieldMessage(result: ApiResult<unknown>): string | null {
  if (result.ok) return null;
  const fields = result.body?.error.fields;
  if (fields === undefined) return null;
  const first = Object.values(fields)[0];
  return first ?? null;
}
