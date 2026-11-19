import type { Limits } from '../shared/types';

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>, readonly retryAfter: number) {
    super(String(body.error ?? status));
  }
  get code(): string {
    return String(this.body.error ?? '');
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) throw new ApiFailure(response.status, parsed, Number(response.headers.get('Retry-After') ?? 0));
  return parsed as T;
}

export const get = <T>(path: string) => request<T>('GET', path);
export const post = <T>(path: string, body: unknown = {}) => request<T>('POST', path, body);
export const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body);
export const put = <T>(path: string, body: unknown = {}) => request<T>('PUT', path, body);
export const del = <T>(path: string) => request<T>('DELETE', path);

let limits: Promise<Limits> | undefined;
export const readLimits = (): Promise<Limits> => (limits ??= get<Limits>('/api/limits'));
