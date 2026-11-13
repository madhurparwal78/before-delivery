import { signedOutRedirect } from './navigation.ts';
import { setUser } from './userState.ts';

/** The browser talks only to the app's own origin. */

export interface Failure {
  status: number;
  code: string | null;
  message: string | null;
  errors: Record<string, string> | null;
  body: Record<string, unknown>;
}

class ApiFailure extends Error {
  readonly failure: Failure;

  constructor(failure: Failure) {
    super(failure.message ?? `Request failed (${failure.status})`);
    this.failure = failure;
  }
}

export class SessionEnded extends Error {}

interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
  raw?: boolean;
}

export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (options.body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }
  if (options.signal !== undefined) init.signal = options.signal;

  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;

  if (options.raw === true && response.ok) return (await response.text()) as T;

  const contentType = response.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json') ? await response.json() : await response.text();

  if (response.ok) return payload as T;

  const body = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
  const failure: Failure = {
    status: response.status,
    code: typeof body.error === 'string' ? body.error : null,
    message: typeof body.message === 'string' ? body.message : null,
    errors: (body.errors as Record<string, string> | undefined) ?? null,
    body,
  };
  if (failure.code === 'not_signed_in') {
    setUser(null);
    signedOutRedirect();
    throw new SessionEnded();
  }
  throw new ApiFailure(failure);
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal): Promise<T> =>
    request<T>('GET', path, signal === undefined ? {} : { signal }),
  text: (path: string, signal?: AbortSignal): Promise<string> =>
    request<string>('GET', path, { raw: true, ...(signal === undefined ? {} : { signal }) }),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>('POST', path, body === undefined ? { body: {} } : { body }),
  put: <T>(path: string, body: unknown): Promise<T> => request<T>('PUT', path, { body }),
  del: <T>(path: string): Promise<T> => request<T>('DELETE', path),
};

export function failureOf(cause: unknown): Failure | null {
  return cause instanceof ApiFailure ? cause.failure : null;
}
