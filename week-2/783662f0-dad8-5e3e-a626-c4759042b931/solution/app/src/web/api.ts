import type { ApiErrorBody } from '../shared/types.js';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    override readonly message: string,
    readonly fields: Record<string, string>,
    readonly etag: string | null,
    readonly retryAfter: number | null,
  ) {
    super(message);
  }
}

interface Sent<T> {
  readonly status: number;
  readonly body: T;
  readonly etag: string | null;
}

interface Options {
  readonly method?: string;
  readonly body?: unknown;
  readonly ifMatch?: string | null;
  readonly idempotencyKey?: string | null;
}

async function send<T>(path: string, options: Options = {}): Promise<Sent<T>> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.ifMatch !== undefined && options.ifMatch !== null) {
    headers['If-Match'] = options.ifMatch;
  }
  if (options.idempotencyKey !== undefined && options.idempotencyKey !== null) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const etag = response.headers.get('etag');
  const type = response.headers.get('content-type') ?? '';

  if (response.status === 204) {
    return { status: 204, body: undefined as T, etag };
  }

  if (!type.includes('application/json')) {
    if (!response.ok) {
      throw new ApiFailure(response.status, 'not_found', 'Something went wrong.', {}, etag, null);
    }
    return { status: response.status, body: (await response.text()) as unknown as T, etag };
  }

  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    const error = payload as ApiErrorBody;
    const retry = response.headers.get('retry-after');
    throw new ApiFailure(
      response.status,
      error.error ?? 'not_found',
      error.message ?? 'Something went wrong.',
      error.fields ?? {},
      error.etag ?? etag,
      retry === null ? null : Number(retry),
    );
  }
  return { status: response.status, body: payload as T, etag };
}

export const get = async <T>(path: string): Promise<T> => (await send<T>(path)).body;

export const getWithEtag = <T>(path: string): Promise<Sent<T>> => send<T>(path);

export const post = async <T>(
  path: string,
  body?: unknown,
  extra: Omit<Options, 'method' | 'body'> = {},
): Promise<T> => (await send<T>(path, { ...extra, method: 'POST', body: body ?? {} })).body;

export const postFull = <T>(
  path: string,
  body?: unknown,
  extra: Omit<Options, 'method' | 'body'> = {},
): Promise<Sent<T>> => send<T>(path, { ...extra, method: 'POST', body: body ?? {} });

export const patch = <T>(path: string, body: unknown, ifMatch: string | null): Promise<Sent<T>> =>
  send<T>(path, { method: 'PATCH', body, ifMatch });

export const remove = <T>(path: string): Promise<Sent<T>> => send<T>(path, { method: 'DELETE' });

/** A fresh key per press, and the same key on an automatic retry. */
export const freshKey = (): string =>
  `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
