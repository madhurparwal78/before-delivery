import type { ApiError as ApiErrorBody } from '../../shared/types.js';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly state: string | null;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error.message ?? 'request failed');
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error.code ?? 'unexpected';
    this.fields = body?.error.fields ?? {};
    this.state = body?.error.state ?? null;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(response.status, parsed as ApiErrorBody | null);
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body ?? {}),
  delete: <T>(path: string): Promise<T> => request<T>('DELETE', path),
};
