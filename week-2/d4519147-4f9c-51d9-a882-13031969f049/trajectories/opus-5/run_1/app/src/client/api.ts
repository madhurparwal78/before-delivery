import type { ApiError } from '../shared/types';

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, body: ApiError) {
    super(body.message);
    this.status = status;
    this.code = body.error;
    this.fields = body.fields ?? {};
  }
}

interface SessionState {
  user: { id: string; email: string; displayName: string } | null;
  csrfToken: string | null;
}

export const sessionState: SessionState = { user: null, csrfToken: null };

export function setSession(user: SessionState['user'], csrfToken: string | null): void {
  sessionState.user = user;
  sessionState.csrfToken = csrfToken;
}

export interface RequestOptions {
  json?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
  redirect?: 'follow' | 'manual';
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  } else if (options.formData) {
    body = options.formData;
  }
  if (STATE_CHANGING.has(method) && sessionState.csrfToken) {
    headers['X-CSRF-Token'] = sessionState.csrfToken;
  }
  const response = await fetch(path, {
    method,
    headers,
    body,
    credentials: 'same-origin',
    redirect: options.redirect ?? 'follow',
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = parsed as ApiError;
    throw new ApiFailure(response.status, {
      error: error.error ?? 'internal',
      message: error.message ?? 'Something went wrong.',
      fields: error.fields,
    });
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, json?: unknown, headers?: Record<string, string>): Promise<T> =>
    request<T>('POST', path, { json: json ?? {}, headers }),
  patch: <T>(path: string, json: unknown): Promise<T> => request<T>('PATCH', path, { json }),
  put: <T>(path: string, json: unknown): Promise<T> => request<T>('PUT', path, { json }),
  del: (path: string): Promise<void> => request<void>('DELETE', path),
  upload: <T>(path: string, formData: FormData): Promise<T> => request<T>('POST', path, { formData }),
};
