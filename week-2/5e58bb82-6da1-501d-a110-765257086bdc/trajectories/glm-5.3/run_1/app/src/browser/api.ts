import { User, Units } from './app.js';

export interface ApiErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string>;
  from?: string;
  to?: string;
  current?: unknown;
  index?: number;
  retry_at?: string;
}

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch<T>(method: string, path: string, body?: unknown, opts: { raw?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: { ...(opts.headers ?? {}) } as Record<string, string>,
  };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, init);
  if (res.status === 204) return undefined as T;
  if (opts.raw) {
    if (!res.ok) {
      let b: ApiErrorBody = { error: 'network', message: 'Could not reach Swathdeck' };
      try { b = await res.json(); } catch { /* no body */ }
      throw new ApiError(res.status, b);
    }
    return (await res.arrayBuffer()) as unknown as T;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data as ApiErrorBody);
  }
  return data as T;
}

export interface Me extends User { }

export async function getMe(): Promise<Me> {
  return apiFetch<Me>('GET', '/api/me');
}

export async function setUnits(units: Units): Promise<Me> {
  return apiFetch<Me>('PATCH', '/api/me', { units });
}

export async function putLastScreen(path: string): Promise<void> {
  await apiFetch<void>('PUT', '/api/me/last-screen', { path }).catch(() => undefined);
}

export interface StatusBody { storage: 'up' | 'down'; mail: 'up' | 'down' }

export async function getStatus(): Promise<StatusBody> {
  return apiFetch<StatusBody>('GET', '/api/status');
}
