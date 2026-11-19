import type { Config } from './types.js';

export const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let body: unknown = null;
    try { body = await response.json(); } catch { /* empty */ }
    throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status, body });
  }
  if (response.status === 204) return null as T;
  return response.json() as Promise<T>;
};

export const api = {
  get: <T>(path: string): Promise<T> => fetchJson<T>(path),
  post: <T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> =>
    fetchJson<T>(path, {
      method: 'POST',
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      body: JSON.stringify(body ?? {}),
    }),
  put: <T>(path: string, body: unknown): Promise<T> =>
    fetchJson<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body: unknown): Promise<T> =>
    fetchJson<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string): Promise<T> => fetchJson<T>(path, { method: 'DELETE' }),
};

export const uploadFile = async (path: string, file: File): Promise<{ ok: true; data: unknown } | { ok: false; body: unknown }> => {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(path, { method: 'POST', body: form });
  const body = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, body };
  return { ok: true, data: body };
};

export const loadConfig = async (): Promise<Config> => api.get<Config>('/api/config');
