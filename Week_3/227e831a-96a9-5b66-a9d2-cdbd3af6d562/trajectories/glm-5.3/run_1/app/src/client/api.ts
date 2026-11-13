import type { ApiErrorBody } from './apiTypes.js';

/**
 * The client's one way of talking to its own origin. Nothing here ever
 * contacts another host, and every error comes back in the published shape.
 */

export interface ApiFailure {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly fields?: Record<string, string> | undefined;
  readonly network: boolean;
}

export type ApiAnswer<T> = { ok: true; body: T } | { ok: false; failure: ApiFailure };

export class NetworkError extends Error {
  constructor() {
    super('network');
  }
}

async function request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<ApiAnswer<T>> {
  const headers: Record<string, string> = { ...(extraHeaders ?? {}) };
  let payload: string | null = null;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  try {
    const init: RequestInit = { method, headers, credentials: 'same-origin' };
    if (payload !== null) init.body = payload;
    const response = await fetch(path, init);
    if (response.status === 204) return { ok: true, body: undefined as T };
    const text = await response.text();
    const parsed = text === '' ? undefined : safeParse(text);
    if (!response.ok) {
      const error = (parsed as ApiErrorBody | undefined)?.error;
      return {
        ok: false,
        failure: {
          status: response.status,
          code: error?.code ?? 'internal_error',
          message: error?.message ?? 'Something went wrong. Try again.',
          fields: error?.fields,
          network: false,
        },
      };
    }
    return { ok: true, body: parsed as T };
  } catch {
    return { ok: false, failure: { status: 0, code: 'network', message: 'network', network: true } };
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('POST', path, body, headers),
  patch: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('PATCH', path, body, headers),
  delete: <T>(path: string) => request<T>('DELETE', path),

  upload: async <T>(path: string, file: File | Blob, field: string): Promise<ApiAnswer<T>> => {
    const form = new FormData();
    form.append(field, file);
    try {
      const response = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
      const text = await response.text();
      const parsed = text === '' ? undefined : safeParse(text);
      if (!response.ok) {
        const error = (parsed as ApiErrorBody | undefined)?.error;
        return {
          ok: false,
          failure: { status: response.status, code: error?.code ?? 'internal_error', message: error?.message ?? 'Something went wrong. Try again.', fields: error?.fields, network: false },
        };
      }
      return { ok: true, body: parsed as T };
    } catch {
      return { ok: false, failure: { status: 0, code: 'network', message: 'network', network: true } };
    }
  },

  download: async (path: string): Promise<Blob | null> => {
    try {
      const response = await fetch(path, { credentials: 'same-origin' });
      if (!response.ok) return null;
      return await response.blob();
    } catch {
      return null;
    }
  },
};
