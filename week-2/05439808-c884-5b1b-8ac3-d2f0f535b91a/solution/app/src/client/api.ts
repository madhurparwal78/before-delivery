// The browser's only door to the server: same-origin JSON with the CSRF token and server-time sync.

interface ApiErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string>;
  nextClaimAt?: string;
  nextDonationAt?: string;
}

/** A refused or failed request. `code` is the published error code, or `network` when nothing came back. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: ApiErrorBody | null,
    readonly retryAfter: number | null,
  ) {
    super(code);
  }
}

const session = { csrf: '' };
let onUnauthenticated: () => void = () => undefined;
let onOutage: (down: boolean) => void = () => undefined;

export function configureApi(hooks: { unauthenticated: () => void; outage: (down: boolean) => void }): void {
  onUnauthenticated = hooks.unauthenticated;
  onOutage = hooks.outage;
}

export function setCsrf(token: string): void {
  session.csrf = token;
}

interface RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
  quietUnauthenticated?: boolean;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    headers['X-CSRF-Token'] = session.csrf;
    headers['Content-Type'] = 'application/json';
  }
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(options.body ?? {}),
    });
  } catch {
    throw new ApiFailure(0, 'network', null, null);
  }
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const body = parsed as ApiErrorBody | null;
    const code = body?.error ?? (response.status >= 500 ? 'internal' : 'unknown');
    if (code === 'database_unavailable') onOutage(true);
    if (code === 'unauthenticated' && !options.quietUnauthenticated) onUnauthenticated();
    const retry = response.headers.get('Retry-After');
    throw new ApiFailure(response.status, code, body, retry === null ? null : Number(retry));
  }
  onOutage(false);
  return parsed as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, body: unknown = {}, options: RequestOptions = {}) => request<T>('POST', path, { ...options, body }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return 'k' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

