export interface ApiFailure {
  code: string;
  message: string;
  fields?: Record<string, string>;
  dates?: string[];
}

export type ApiResult<T> =
  | { ok: true; status: number; data: T; replay: boolean }
  | { ok: false; status: number; error: ApiFailure; retryAfterSeconds: number };

let clockOffsetMs = 0;

/** The browser clock plus the offset to the latest server Date header. */
export function serverNow(): number {
  return Date.now() + clockOffsetMs;
}

function noteServerClock(headerValue: string | null): void {
  if (headerValue === null) return;
  const parsed = Date.parse(headerValue);
  if (Number.isNaN(parsed)) return;
  clockOffsetMs = parsed - Date.now();
}

function csrfToken(): string {
  const match = /(?:^|;\s*)pl_csrf=([^;]*)/.exec(document.cookie);
  return match === null ? '' : decodeURIComponent(match[1] as string);
}

type Listener = () => void;

const unauthenticatedListeners: Listener[] = [];

export function onUnauthenticated(listener: Listener): void {
  unauthenticatedListeners.push(listener);
}

const UNAUTHENTICATED = new Set(['unauthenticated', 'session_invalid', 'session_expired']);

export interface RequestOptions {
  method?: string;
  body?: unknown;
  form?: FormData;
  idempotencyKey?: string;
  skipAuthGate?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.form !== undefined) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrfToken();
  if (options.idempotencyKey !== undefined) headers['Idempotency-Key'] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: 'offline', message: 'offline' },
      retryAfterSeconds: 0,
    };
  }
  noteServerClock(response.headers.get('Date'));
  const retryAfterSeconds = Number.parseInt(response.headers.get('Retry-After') ?? '0', 10) || 0;
  if (response.status === 204) {
    return { ok: true, status: 204, data: null as unknown as T, replay: false };
  }
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/json')) {
    if (response.ok) {
      return { ok: true, status: response.status, data: null as unknown as T, replay: false };
    }
    return {
      ok: false,
      status: response.status,
      error: { code: 'internal', message: 'internal' },
      retryAfterSeconds,
    };
  }
  const payload = (await response.json()) as unknown;
  if (response.ok) {
    return {
      ok: true,
      status: response.status,
      data: payload as T,
      replay: response.headers.get('Idempotent-Replay') === 'true',
    };
  }
  const error = (payload as { error?: ApiFailure }).error ?? {
    code: 'internal',
    message: 'internal',
  };
  if (UNAUTHENTICATED.has(error.code) && options.skipAuthGate !== true) {
    for (const listener of unauthenticatedListeners) listener();
  }
  return { ok: false, status: response.status, error, retryAfterSeconds };
}

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
