import type { ApiErrorBody } from '../shared/api.js';

// A refused request: the status and the published error body.
class ApiFailure extends Error {
  constructor(readonly status: number, readonly body: ApiErrorBody) {
    super(body.message);
  }
}

async function send<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new ApiFailure(response.status, parsed as ApiErrorBody);
  return parsed as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => send<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => send<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown): Promise<T> => send<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown): Promise<T> => send<T>('PATCH', path, body),
  del: <T = void>(path: string): Promise<T> => send<T>('DELETE', path),
  upload<T>(path: string, file: File): Promise<T> {
    const form = new FormData();
    form.append('file', file, file.name);
    return send<T>('POST', path, undefined, form);
  },
  async download(path: string): Promise<Blob> {
    const response = await fetch(path, { credentials: 'same-origin' });
    if (!response.ok) throw new ApiFailure(response.status, await response.json() as ApiErrorBody);
    return response.blob();
  },
};

export const failureOf = (error: unknown): ApiFailure =>
  error instanceof ApiFailure ? error : new ApiFailure(0, { error: 'validation', message: 'The server did not answer.' });
