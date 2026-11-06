export type ApiFailure = {
  code: string;
  message: string;
  errors: Record<string, string> | null;
  nextClaimAt: string | null;
  nextDonationAt: string | null;
  retryAfter: number | null;
  status: number;
};

export class ApiRequestError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiRequestError';
  }
}

let csrfToken: string | null = null;
const sessionListeners: (() => void)[] = [];

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function onSessionEnded(listener: () => void): void {
  sessionListeners.push(listener);
}

export type RequestOptions = {
  body?: unknown;
  idempotencyKey?: string;
};

export async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrfToken !== null && method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch {
    throw new ApiRequestError({
      code: 'network',
      message: 'network failure',
      errors: null,
      nextClaimAt: null,
      nextDonationAt: null,
      retryAfter: null,
      status: 0
    });
  }
  if (response.status === 204) return undefined as T;
  const raw = await response.text();
  const parsed: unknown = raw.length === 0 ? null : JSON.parse(raw);
  if (response.ok) return parsed as T;
  const bodyObject = (parsed ?? {}) as Record<string, unknown>;
  const failure: ApiFailure = {
    code: typeof bodyObject.error === 'string' ? bodyObject.error : 'internal',
    message: typeof bodyObject.message === 'string' ? bodyObject.message : 'request failed',
    errors:
      typeof bodyObject.errors === 'object' && bodyObject.errors !== null
        ? (bodyObject.errors as Record<string, string>)
        : null,
    nextClaimAt: typeof bodyObject.nextClaimAt === 'string' ? bodyObject.nextClaimAt : null,
    nextDonationAt:
      typeof bodyObject.nextDonationAt === 'string' ? bodyObject.nextDonationAt : null,
    retryAfter: Number(response.headers.get('Retry-After')) || null,
    status: response.status
  };
  if (failure.code === 'unauthenticated') {
    for (const listener of sessionListeners) listener();
  }
  throw new ApiRequestError(failure);
}

export function newIdempotencyKey(prefix: string): string {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}-${random[0]?.toString(36) ?? '0'}${random[1]?.toString(36) ?? '0'}`;
}
