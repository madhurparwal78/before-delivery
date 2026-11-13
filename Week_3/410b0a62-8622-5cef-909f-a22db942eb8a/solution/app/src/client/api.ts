import type { ErrorBody, ValidationBody } from '../shared/types.js';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody | ValidationBody | null
  ) {
    super(body && 'message' in body ? body.message : `request failed with ${status}`);
  }
}

type Listener = () => void;
const unauthenticatedListeners = new Set<Listener>();
export const onUnauthenticated = (listener: Listener): (() => void) => {
  unauthenticatedListeners.add(listener);
  return () => unauthenticatedListeners.delete(listener);
};

async function send<T>(method: string, path: string, body?: BodyInit, headers?: Record<string, string>): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body !== undefined) init.body = body;
  if (headers) init.headers = headers;
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = data as ErrorBody | ValidationBody | null;
    if (response.status === 401 && failure && 'error' in failure && failure.error === 'unauthenticated') unauthenticatedListeners.forEach((listener) => listener());
    throw new ApiFailure(response.status, failure);
  }
  return data as T;
}

export const get = <T,>(path: string): Promise<T> => send<T>('GET', path);
export const post = <T,>(path: string, body?: unknown): Promise<T> =>
  send<T>('POST', path, body === undefined ? undefined : JSON.stringify(body), { 'content-type': 'application/json' });
export const patch = <T,>(path: string, body: unknown): Promise<T> => send<T>('PATCH', path, JSON.stringify(body), { 'content-type': 'application/json' });
export const del = (path: string): Promise<void> => send<void>('DELETE', path);
export const postForm = <T,>(path: string, form: FormData): Promise<T> => send<T>('POST', path, form);

/** The per-field messages of a validation failure, or null for any other failure. */
export function fieldErrors(error: unknown): Record<string, string> | null {
  return error instanceof ApiFailure && error.body && 'errors' in error.body ? error.body.errors : null;
}

/** The server's message for a failure that is not a field validation. */
export function failureMessage(error: unknown): string {
  if (error instanceof ApiFailure && error.body && 'message' in error.body) return error.body.message;
  if (error instanceof ApiFailure && error.body && 'errors' in error.body) return Object.values(error.body.errors).join(' ');
  return 'Something went wrong. Try again.';
}

export const isNotFound = (error: unknown): boolean => error instanceof ApiFailure && error.status === 404;
