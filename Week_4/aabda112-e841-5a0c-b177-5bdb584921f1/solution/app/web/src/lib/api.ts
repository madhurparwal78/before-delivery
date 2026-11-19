import type { ApiErrorBody, ErrorCode } from '../../../shared/errors';
import { noteLiveSeq } from './live';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();
let signedOut: (() => void) | null = null;

export function onSessionEnded(handler: () => void): void {
  signedOut = handler;
}

/** Server-started announcements wait here while one of this window's own actions is still being handled. */
let holds = 0;
const deferred: Listener[] = [];

export function whenSettled(run: Listener): void {
  if (holds === 0) run();
  else deferred.push(run);
}

/** Runs an action of this window; announcements the server starts meanwhile follow the action's own. */
export async function mutate<T>(action: () => Promise<T>, done?: (result: T) => void): Promise<T> {
  holds++;
  try {
    const result = await action();
    done?.(result);
    return result;
  } finally {
    holds--;
    if (holds === 0) deferred.splice(0).forEach((run) => run());
    listeners.forEach((l) => l());
  }
}

interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function api<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  if (path === '/api/me') noteLiveSeq(response.headers.get('X-Live-Seq'));
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = (data ?? {}) as Partial<ApiErrorBody>;
    const error = new ApiError(response.status, body.error ?? 'validation_failed', body.message ?? 'Something went wrong.', body.field);
    if (error.code === 'unauthenticated' && path !== '/api/me') signedOut?.();
    throw error;
  }
  return data as T;
}

export const get = <T>(path: string) => api<T>('GET', path);
export const post = <T>(path: string, body?: unknown, headers?: Record<string, string>) => api<T>('POST', path, { body: body ?? {}, headers });
export const put = <T>(path: string, body: unknown) => api<T>('PUT', path, { body });
export const patch = <T>(path: string, body: unknown) => api<T>('PATCH', path, { body });
export const del = <T>(path: string) => api<T>('DELETE', path);

/** A request that ended with no response at all (connection lost), as opposed to an answer with an error status. */
export const lostResponse = (error: unknown): boolean => error instanceof TypeError;

export function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}
