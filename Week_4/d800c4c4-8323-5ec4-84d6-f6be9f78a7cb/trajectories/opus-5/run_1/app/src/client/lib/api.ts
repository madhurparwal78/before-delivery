import type { ApiError } from '../../shared/types';

export class ApiFailed extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    readonly fields: Record<string, string> | null,
  ) {
    super(error);
  }
}

async function send<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  if (signal) init.signal = signal;
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    const failure = (parsed ?? {}) as ApiError;
    throw new ApiFailed(response.status, failure.error ?? 'Something went wrong.', failure.fields ?? null);
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal): Promise<T> =>
    send<T>('GET', path, undefined, signal),
  post: <T>(path: string, body?: unknown): Promise<T> => send<T>('POST', path, body),
  put: <T>(path: string, body?: unknown): Promise<T> => send<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown): Promise<T> => send<T>('PATCH', path, body),
  remove: <T>(path: string): Promise<T> => send<T>('DELETE', path),
};
