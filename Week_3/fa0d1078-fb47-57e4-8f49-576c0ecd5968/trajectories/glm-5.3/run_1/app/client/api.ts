import type { Player } from '../shared/api.js';

// The API fetcher. All request and response bodies are JSON.

export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
  move?: number | null;
}

export class ApiError extends Error {
  constructor(public readonly failure: ApiFailure) {
    super(failure.message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    const error = (json as { error?: { code?: string; message?: string; fields?: Record<string, string>; move?: number | null } } | null)?.error;
    throw new ApiError({
      status: res.status,
      code: error?.code ?? (res.status === 0 ? 'NETWORK' : 'UNKNOWN'),
      message: error?.message ?? '',
      fields: error?.fields,
      move: error?.move,
    });
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
};

export interface MeResponse { player: Player }
