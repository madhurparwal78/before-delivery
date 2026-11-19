import { OUTAGE_COPY } from '../src/shared/copy';

/**
 * The browser's one request path. It adds the bearer token, refreshes the
 * session once when a write is refused as unauthenticated, and repeats the
 * original request with the same body and the same Idempotency-Key.
 */

export interface Account {
  readonly id: string;
  readonly email: string;
  readonly display_name: string;
  readonly role: 'sailmaker' | 'loft-hand' | 'yacht-owner';
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly extra: Readonly<Record<string, unknown>>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body['message'] === 'string' ? body['message'] : 'Not found.');
    this.name = 'ApiError';
    this.status = status;
    this.code = typeof body['error'] === 'string' ? body['error'] : 'not_found';
    this.fields = (body['fields'] as Record<string, string> | undefined) ?? {};
    this.extra = body;
  }
}

/** The token lives in memory only, so it never reaches storage or the markup. */
let token: string | null = null;
let account: Account | null = null;
let refreshing: Promise<boolean> | null = null;

export function currentAccount(): Account | null {
  return account;
}

export function setSession(next: { account: Account; access_token: string } | null): void {
  account = next === null ? null : next.account;
  token = next === null ? null : next.access_token;
}

/** Signing out drops every record the browser holds. */
export function dropSession(): void {
  account = null;
  token = null;
  refreshing = null;
}

export interface Request {
  readonly method?: string;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  /** The current revision of a versioned record, sent as `If-Match`. */
  readonly ifMatch?: number;
  readonly raw?: Blob;
  readonly contentType?: string;
  readonly expect?: 'json' | 'text' | 'blob' | 'none';
}

async function send(path: string, request: Request): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token !== null) headers['authorization'] = `Bearer ${token}`;
  if (request.idempotencyKey !== undefined) headers['idempotency-key'] = request.idempotencyKey;
  if (request.ifMatch !== undefined) headers['if-match'] = `"${request.ifMatch}"`;
  let body: BodyInit | undefined;
  if (request.raw !== undefined) {
    body = request.raw;
    headers['content-type'] = request.contentType ?? 'application/octet-stream';
  } else if (request.body !== undefined) {
    body = JSON.stringify(request.body);
    headers['content-type'] = 'application/json';
  }
  return fetch(path, {
    method: request.method ?? 'GET',
    headers,
    body,
    credentials: 'same-origin',
  });
}

async function refreshOnce(): Promise<boolean> {
  if (refreshing !== null) return refreshing;
  refreshing = (async () => {
    const response = await fetch('/api/session', { credentials: 'same-origin' });
    if (!response.ok) return false;
    const body = (await response.json()) as { account: Account; access_token: string };
    setSession(body);
    return true;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export type OutageListener = (copy: string | null) => void;
let outageListener: OutageListener = () => undefined;

export function onOutage(listener: OutageListener): void {
  outageListener = listener;
}

/**
 * Calls the API once, refreshing the session a single time when the answer is
 * 401. Several writes refused at the same moment share that one call.
 */
export async function call<T>(path: string, request: Request = {}): Promise<T> {
  let response = await send(path, request);
  if (response.status === 401) {
    const refreshed = await refreshOnce();
    if (!refreshed) {
      dropSession();
      const resume = encodeURIComponent(location.pathname + location.search);
      location.assign(`/signin?resume=${resume}&ended=1`);
      throw new ApiError(401, { error: 'unauthenticated', message: 'Sign in to continue.' });
    }
    response = await send(path, request);
  }

  if (response.status === 204) {
    outageListener(null);
    return undefined as T;
  }

  const type = response.headers.get('content-type') ?? '';
  if (!response.ok) {
    const body = type.includes('json') ? ((await response.json()) as Record<string, unknown>) : {};
    const error = new ApiError(response.status, body);
    outageListener(error.code === 'store_unavailable' ? error.message : null);
    throw error;
  }
  outageListener(null);

  if (request.expect === 'text') return (await response.text()) as T;
  if (request.expect === 'blob') return (await response.blob()) as T;
  if (request.expect === 'none') return undefined as T;
  return (await response.json()) as T;
}

export async function signIn(email: string, password: string): Promise<Account> {
  const response = await fetch('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    credentials: 'same-origin',
  });
  if (!response.ok) {
    const body = (await response.json()) as Record<string, unknown>;
    throw new ApiError(response.status, body);
  }
  const body = (await response.json()) as { account: Account; access_token: string };
  setSession(body);
  return body.account;
}

/** Picks the session back up on a reload, from the cookie alone. */
export async function resumeSession(): Promise<Account | null> {
  const response = await fetch('/api/session', { credentials: 'same-origin' });
  if (!response.ok) return null;
  const body = (await response.json()) as { account: Account; access_token: string };
  setSession(body);
  return body.account;
}

export async function signOut(): Promise<void> {
  try {
    await call('/api/session', { method: 'DELETE', expect: 'none' });
  } finally {
    dropSession();
  }
}

export const DATABASE_OUTAGE = OUTAGE_COPY.database;
