import type { ApiErrorBody } from './types.js';

export interface ApiOptions {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  formData?: FormData;
  raw?: boolean;
}

/** API fetch that refreshes once on session_expired, shared by concurrent requests. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public message: string,
    public extra: Record<string, unknown>,
  ) {
    super(message);
  }
}

export class ValidationError extends Error {
  constructor(public errors: Record<string, string>) {
    super('validation');
  }
}

async function doFetch(path: string, options: ApiOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const init: RequestInit = { method: options.method ?? 'GET', headers, credentials: 'same-origin' };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  if (options.formData !== undefined) {
    init.body = options.formData;
    delete headers['content-type'];
  }
  return fetch(`/api${path}`, init);
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch('/auth/refresh', { method: 'POST', credentials: 'same-origin' });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  let res = await doFetch(path, options);
  if (res.status === 401) {
    // A 401 with session_expired refreshes once, shared by concurrent requests.
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.clone().json()) as ApiErrorBody;
    } catch {
      body = null;
    }
    if (body?.error?.code === 'session_expired') {
      const ok = await refreshOnce();
      if (ok) {
        res = await doFetch(path, options);
      } else {
        window.dispatchEvent(new CustomEvent('spindrift:signedout'));
        throw new ApiError(401, 'signed_out', 'Your session ended. Sign in again — what you entered is kept.', {});
      }
    } else {
      throw new ApiError(401, body?.error?.code ?? 'unauthenticated', '', {});
    }
  }
  if (res.status === 422) {
    const body = (await res.json()) as { errors?: Record<string, string>; error?: { code: string; message?: string } };
    if (body.errors) throw new ValidationError(body.errors);
    throw new ApiError(422, body.error?.code ?? 'validation', body.error?.message ?? '', {});
  }
  if (res.status === 413) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    if (body?.error) {
      throw new ApiError(413, body.error.code, body.error.message ?? '', body.error);
    }
    throw new ApiError(413, 'body_too_large', '', {});
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    const err = body?.error;
    throw new ApiError(res.status, err?.code ?? 'error', typeof err?.message === 'string' ? err.message : '', err ?? {});
  }
  if (res.status === 204) return undefined as T;
  if (options.raw) return res as unknown as T;
  return (await res.json()) as T;
}

