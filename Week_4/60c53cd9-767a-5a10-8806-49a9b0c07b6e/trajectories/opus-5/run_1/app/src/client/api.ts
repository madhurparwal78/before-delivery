/** The browser's one API client. It also keeps the offset to the server's clock. */

import type { ApiErrorBody } from '../shared/types';

export interface ApiResult<T> {
  status: number;
  ok: boolean;
  data: T | null;
  error: ApiErrorBody['error'] | null;
  retryAfterSeconds: number | null;
  /** True when the request never got an HTTP response at all. */
  unreachable: boolean;
}

let serverOffsetMs = 0;

export function serverNow(): number {
  return Date.now() + serverOffsetMs;
}

function noteServerDate(header: string | null): void {
  if (!header) return;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) serverOffsetMs = date - Date.now();
}

export interface RequestOptions {
  body?: unknown;
  raw?: Blob | ArrayBuffer | Uint8Array;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined;
  if (options.raw !== undefined) {
    body = options.raw as BodyInit;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, signal: options.signal, credentials: 'same-origin' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return { status: 0, ok: false, data: null, error: null, retryAfterSeconds: null, unreachable: true };
  }
  noteServerDate(response.headers.get('date'));
  const retryAfter = response.headers.get('retry-after');
  const text = await response.text();
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (response.ok) {
    return {
      status: response.status,
      ok: true,
      data: payload as T,
      error: null,
      retryAfterSeconds: retryAfter ? Number(retryAfter) : null,
      unreachable: false,
    };
  }
  const errorBody = (payload as ApiErrorBody | null)?.error ?? null;
  return {
    status: response.status,
    ok: false,
    data: null,
    error: errorBody,
    retryAfterSeconds: retryAfter ? Number(retryAfter) : null,
    unreachable: false,
  };
}

export const get = <T>(path: string, options?: RequestOptions): Promise<ApiResult<T>> =>
  request<T>('GET', path, options);
export const post = <T>(path: string, options?: RequestOptions): Promise<ApiResult<T>> =>
  request<T>('POST', path, options);
export const put = <T>(path: string, options?: RequestOptions): Promise<ApiResult<T>> =>
  request<T>('PUT', path, options);
export const del = <T>(path: string, options?: RequestOptions): Promise<ApiResult<T>> =>
  request<T>('DELETE', path, options);
