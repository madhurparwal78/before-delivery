/**
 * Talking to the app's own API. When access expires the browser refreshes once,
 * shared by concurrent requests, and replays the original request with its
 * payload. A failed refresh leaves the signed-out state for the screen to show.
 */

export interface ApiErrorBody {
  code: string;
  message?: string;
  [key: string]: unknown;
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: { error?: ApiErrorBody; errors?: Record<string, string> },
  ) {
    super(body.error?.code ?? 'request_failed');
  }

  get code(): string {
    return this.body.error?.code ?? '';
  }

  get fieldErrors(): Record<string, string> {
    return this.body.errors ?? {};
  }

  /** The published message an action shows in its live region. */
  get publicMessage(): string | null {
    return this.body.error?.message ?? null;
  }

  extra<T>(name: string): T | undefined {
    return this.body.error?.[name] as T | undefined;
  }
}

export class SignedOut extends Error {}

type Listener = () => void;
const signedOutListeners = new Set<Listener>();

export function onSignedOut(listener: Listener): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

function announceSignedOut(): void {
  for (const listener of signedOutListeners) listener();
}

let refreshInFlight: Promise<boolean> | null = null;

/** One refresh at a time, shared by every request that met the expiry. */
async function refreshAccess(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch('/auth/refresh', { method: 'POST', credentials: 'same-origin' })
      .then((res) => res.status === 204)
      .catch(() => false)
      .finally(() => {
        // Let the next expiry start a fresh refresh.
        setTimeout(() => {
          refreshInFlight = null;
        }, 0);
      });
  }
  return refreshInFlight;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Multipart uploads send their own body and progress. */
  raw?: BodyInit;
  signal?: AbortSignal;
}

async function readBody(res: Response): Promise<unknown> {
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json')) return res.json().catch(() => ({}));
  if (res.status === 204) return undefined;
  return res.text().catch(() => '');
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined = options.raw;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  return fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers,
    body,
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let res = await send(path, options);

  if (res.status === 401) {
    const body = (await readBody(res)) as { error?: ApiErrorBody };
    if (body?.error?.code === 'session_expired') {
      const refreshed = await refreshAccess();
      if (!refreshed) {
        announceSignedOut();
        throw new SignedOut();
      }
      // Replay the original request with the same payload.
      res = await send(path, options);
    } else {
      throw new ApiFailure(res.status, body ?? {});
    }
  }

  if (res.status === 204) return undefined as T;
  const payload = await readBody(res);
  if (!res.ok) {
    throw new ApiFailure(
      res.status,
      (payload ?? {}) as { error?: ApiErrorBody; errors?: Record<string, string> },
    );
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal): Promise<T> =>
    request<T>(path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> =>
    request<T>(path, { method: 'POST', ...(body === undefined ? {} : { body }), ...(headers ? { headers } : {}) }),
  put: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'PUT', ...(body === undefined ? {} : { body }) }),
  del: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData): Promise<T> =>
    request<T>(path, { method: 'POST', raw: form }),
};

/** Sign-in keeps the current route as the return route. */
export function signInHref(returnTo: string): string {
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}
