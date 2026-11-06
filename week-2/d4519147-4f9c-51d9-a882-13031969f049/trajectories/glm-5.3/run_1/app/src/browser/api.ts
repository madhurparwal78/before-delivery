// The browser-side API client: JSON requests with the session's CSRF token,
// the one error shape, and session-expiry detection.

export interface ApiError {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(err: ApiError) {
    super(err.message);
    this.status = err.status;
    this.code = err.code;
    this.fields = err.fields;
  }
}

export class NetworkError extends Error {
  constructor() {
    super('network');
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function currentCsrfToken(): string | null {
  return csrfToken;
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
}

async function request(method: string, path: string, body?: unknown, options?: { idempotencyKey?: string; raw?: FormData }): Promise<unknown> {
  const init: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  if (options?.raw !== undefined) {
    init.body = options.raw;
  }
  if (options?.idempotencyKey !== undefined) {
    (init.headers as Record<string, string>)['Idempotency-Key'] = options.idempotencyKey;
  }
  if (csrfToken !== null && method !== 'GET') {
    (init.headers as Record<string, string>)['X-CSRF-Token'] = csrfToken;
  }
  let resp: Response;
  try {
    resp = await fetch(path, init);
  } catch {
    throw new NetworkError();
  }
  if (resp.status === 204) return null;
  const text = await resp.text();
  let parsed: unknown = null;
  if (text !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!resp.ok) {
    const err = parsed as { error?: string; message?: string; fields?: Record<string, string> } | null;
    throw new ApiRequestError({
      status: resp.status,
      code: err?.error ?? 'unknown',
      message: err?.message ?? '',
      fields: err?.fields,
    });
  }
  return parsed;
}

export function apiGet(path: string): Promise<unknown> {
  return request('GET', path);
}

export function apiPost(path: string, body?: unknown, options?: { idempotencyKey?: string; raw?: FormData }): Promise<unknown> {
  return request('POST', path, body ?? {}, options);
}

export function apiPut(path: string, body: unknown): Promise<unknown> {
  return request('PUT', path, body);
}

export function apiPatch(path: string, body: unknown): Promise<unknown> {
  return request('PATCH', path, body);
}

export function apiDelete(path: string): Promise<unknown> {
  return request('DELETE', path);
}

// The `next` check: a valid next starts with exactly one /, the character
// after it is neither / nor \, and it has no backslash or control character.
export function validNext(next: string | null): string | null {
  if (next === null || next === '') return null;
  if (!next.startsWith('/') || next.length < 2) return null;
  const second = next[1];
  if (second === '/' || second === '\\') return null;
  if (next.includes('\\')) return null;
  if (/[\u0000-\u001F\u007F]/.test(next)) return null;
  return next;
}

export function decodeNextParam(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
