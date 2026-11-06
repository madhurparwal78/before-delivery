// The browser's one way to the API.

import { sessionEnded } from './session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

interface Options {
  method?: string;
  body?: unknown;
  file?: File;
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const init: RequestInit = { method: options.method ?? 'GET', credentials: 'same-origin' };
  if (options.file) {
    const form = new FormData();
    form.append('file', options.file);
    init.body = form;
  } else if (options.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, init);
  const text = await response.text();
  if (!response.ok) {
    let error: { code?: string; message?: string; fields?: Record<string, string> } = {};
    try {
      error = (JSON.parse(text) as { error?: typeof error }).error ?? {};
    } catch {
      error = {};
    }
    if (response.status === 401 && (error.code === 'session_ended' || error.code === 'notSignedIn')) sessionEnded(init.method !== 'GET');
    throw new ApiError(response.status, error.code ?? 'unknown', error.message ?? '', error.fields ?? {});
  }
  return (text ? JSON.parse(text) : undefined) as T;
}
