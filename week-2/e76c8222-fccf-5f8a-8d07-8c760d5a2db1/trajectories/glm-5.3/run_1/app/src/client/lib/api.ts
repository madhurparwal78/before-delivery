import type { ApiErrorBody } from './types.js';

export class ApiFailure {
  readonly code: string;
  readonly message: string;
  readonly body: ApiErrorBody['error'];
  readonly status: number;

  constructor(status: number, body: ApiErrorBody['error']) {
    this.status = status;
    this.code = body?.code ?? 'unknown';
    this.message = body?.message ?? 'Something went wrong.';
    this.body = body;
  }
}

async function request<T>(method: string, path: string, body?: unknown, extra?: HeadersInit): Promise<T> {
  const init: RequestInit = { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`/api${path}`, init);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiFailure(res.status, (data as ApiErrorBody).error);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, extra?: HeadersInit) => request<T>('GET', path, undefined, extra),
  post: <T>(path: string, body?: unknown, extra?: HeadersInit) => request<T>('POST', path, body, extra),
  put: <T>(path: string, body?: unknown, extra?: HeadersInit) => request<T>('PUT', path, body, extra),
  patch: <T>(path: string, body?: unknown, extra?: HeadersInit) => request<T>('PATCH', path, body, extra),
  del: <T>(path: string) => request<T>('DELETE', path),
  postForm: async <T>(path: string, formData: FormData): Promise<T> => {
    const res = await fetch(`/api${path}`, { method: 'POST', body: formData });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new ApiFailure(res.status, (data as ApiErrorBody).error);
    return data as T;
  },
  raw: (path: string) => fetch(`/api${path}`),
};

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isFailure(value: unknown): value is ApiFailure {
  return value instanceof ApiFailure;
}
