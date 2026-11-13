/** The browser's one way to the server, with a single refresh-and-replay on an expired access. */

import type { ApiErrorBody } from '../shared/types.js';

export class ApiFailure extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }

  field(name: string): string | undefined {
    return this.body.errors?.[name];
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  form?: FormData;
  /** Set on the session probe, which must not send a visitor to the sign-in page. */
  allowSignedOut?: boolean;
};

let refreshing: Promise<boolean> | null = null;
let signedOutHandler: (() => void) | null = null;

export function onSignedOut(handler: () => void): void {
  signedOutHandler = handler;
}

async function refreshOnce(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      setTimeout(() => {
        refreshing = null;
      }, 0);
    });
  return refreshing;
}

async function send(path: string, options: Options): Promise<Response> {
  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers: { ...(options.headers ?? {}) },
  };
  if (options.form !== undefined) {
    init.body = options.form;
  } else if (options.body !== undefined) {
    init.headers = { ...init.headers, 'content-type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }
  return fetch(path, init);
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  let response = await send(path, options);
  if (response.status === 401) {
    const body = (await response.clone().json().catch(() => null)) as ApiErrorBody | null;
    if (body?.error === 'signed_out') {
      const refreshed = await refreshOnce();
      if (refreshed) {
        response = await send(path, options);
      } else if (options.allowSignedOut !== true) {
        signedOutHandler?.();
      }
    }
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    throw new ApiFailure(response.status, (parsed ?? { error: 'not_found', message: '' }) as ApiErrorBody);
  }
  return parsed as T;
}
