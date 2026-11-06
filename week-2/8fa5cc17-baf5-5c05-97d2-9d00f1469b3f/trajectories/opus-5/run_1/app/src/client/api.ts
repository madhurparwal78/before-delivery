export type ApiResult<T> =
  | { ok: true; status: number; data: T; headers: Headers }
  | { ok: false; status: number; error: string; errors?: Record<string, string>; data?: unknown };

export type SessionInfo = {
  user: { email: string; display_name: string };
  csrf_token: string;
  session_id: string;
  home_time_zone: string;
  theme: 'paper' | 'lamplight';
};

let csrfToken = '';
let onUnauthenticated: (() => void) | null = null;

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

export async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string>; form?: FormData } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let payload: BodyInit | undefined;
  if (options.form !== undefined) {
    payload = options.form;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }
  if (method !== 'GET' && method !== 'HEAD' && path !== '/api/auth/sign-in') {
    headers['X-CSRF-Token'] = csrfToken;
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    return { ok: false, status: 0, error: 'network' };
  }
  if (response.status === 401 && path !== '/api/auth/sign-in' && onUnauthenticated !== null) {
    onUnauthenticated();
  }
  if (response.status === 204) {
    return { ok: true, status: 204, data: null as unknown as T, headers: response.headers };
  }
  let data: unknown = null;
  const text = await response.text();
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (response.ok) return { ok: true, status: response.status, data: data as T, headers: response.headers };
  const record = data === null || typeof data !== 'object' ? {} : (data as Record<string, unknown>);
  return {
    ok: false,
    status: response.status,
    error: typeof record['error'] === 'string' ? record['error'] : 'error',
    errors:
      record['errors'] !== undefined && typeof record['errors'] === 'object'
        ? (record['errors'] as Record<string, string>)
        : undefined,
    data,
  };
}

export const api = {
  get: <T>(path: string): Promise<ApiResult<T>> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResult<T>> =>
    request<T>('POST', path, { body, headers }),
  put: <T>(path: string, body?: unknown): Promise<ApiResult<T>> => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown): Promise<ApiResult<T>> => request<T>('PATCH', path, { body }),
  del: <T>(path: string): Promise<ApiResult<T>> => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData): Promise<ApiResult<T>> => request<T>('POST', path, { form }),
};
