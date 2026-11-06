/** The one way the browser talks to the API, always same-origin. */

import { GENERIC_ERROR } from '../shared/copy.js';
import type { ErrorBody } from '../shared/types.js';
import { syncServerNow } from './clock.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(body.error);
  }

  get code(): string {
    return this.body.error;
  }

  /** Field messages from a 422. */
  get fieldErrors(): Record<string, string> {
    const errors = this.body['errors'];
    return typeof errors === 'object' && errors !== null
      ? (errors as Record<string, string>)
      : {};
  }
}

interface RequestOptions {
  body?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined;
  if (options.formData !== undefined) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, { error: 'network' });
  }

  const payload: unknown =
    response.status === 204 ? null : await response.json().catch(() => null);

  if (
    typeof payload === 'object' &&
    payload !== null &&
    'server_now' in payload &&
    typeof (payload as { server_now: unknown }).server_now === 'string'
  ) {
    syncServerNow((payload as { server_now: string }).server_now);
  }

  if (!response.ok) {
    const errorBody: ErrorBody =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? (payload as ErrorBody)
        : { error: 'internal' };
    // A session that has gone away sends the user back to sign in, wherever the
    // call came from. The session probe itself is how a visitor is recognised.
    if (response.status === 401 && errorBody.error === 'unauthenticated' && path !== '/api/me') {
      onSessionLost?.();
    }
    throw new ApiError(response.status, errorBody);
  }
  return payload as T;
}

let onSessionLost: (() => void) | null = null;

export function handleSessionLoss(handler: () => void): void {
  onSessionLost = handler;
}

/**
 * Starts work that is not a user action, such as a screen's first load or the
 * refresh loop. A failure leaves the screen as it is; the next cycle retries,
 * and a lost session has already been handled above.
 */
export function inBackground(work: () => Promise<unknown>): void {
  void work().catch(() => undefined);
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> =>
    request<T>('POST', path, { body: body ?? {}, headers }),
  upload: <T>(path: string, formData: FormData): Promise<T> =>
    request<T>('POST', path, { formData }),
  del: <T>(path: string): Promise<T> => request<T>('DELETE', path),
};

/** Turns anything thrown by a request into copy for a live region. */
export function messageFor(error: unknown, known: Record<string, string> = {}): string {
  if (error instanceof ApiError && known[error.code] !== undefined) return known[error.code];
  return GENERIC_ERROR;
}
