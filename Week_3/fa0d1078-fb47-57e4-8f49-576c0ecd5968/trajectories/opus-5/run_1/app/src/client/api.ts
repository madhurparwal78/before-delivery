import type { ApiErrorBody, ClientConfig } from '../shared/api';

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly move: number | null;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error.message ?? 'request failed');
    this.name = 'ApiFailure';
    this.status = status;
    this.code = body?.error.code ?? 'INTERNAL';
    this.fields = body?.error.fields ?? {};
    this.move = body?.error.move ?? null;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiFailure(0, null);
  }
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw new ApiFailure(response.status, payload as ApiErrorBody | null);
  return payload as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown): Promise<T> => request<T>('PUT', path, body),
};

export const clientConfig: ClientConfig = (() => {
  const script = document.getElementById('seam-config');
  const fallback: ClientConfig = {
    mistake_limit: 3,
    hint_limit: 3,
    move_limit: 5000,
    daily_start: '2026-01-01',
    leaderboard_size: 20,
  };
  if (!script?.textContent) return fallback;
  return { ...fallback, ...(JSON.parse(script.textContent) as Partial<ClientConfig>) };
})();
