export type ApiResult<T = Record<string, unknown>> = {
  ok: boolean;
  status: number;
  body: T;
  networkError: boolean;
};

async function send<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  try {
    const init: RequestInit = { method, headers: { ...headers }, credentials: 'same-origin' };
    if (body !== undefined) {
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const response = await fetch(path, init);
    const text = await response.text();
    const parsed = (text === '' ? {} : JSON.parse(text)) as T;
    return { ok: response.ok, status: response.status, body: parsed, networkError: false };
  } catch {
    return { ok: false, status: 0, body: {} as T, networkError: true };
  }
}

export const api = {
  get: <T = Record<string, unknown>>(path: string): Promise<ApiResult<T>> =>
    send<T>('GET', path),
  post: <T = Record<string, unknown>>(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<ApiResult<T>> => send<T>('POST', path, body ?? {}, headers),
  patch: <T = Record<string, unknown>>(path: string, body: unknown): Promise<ApiResult<T>> =>
    send<T>('PATCH', path, body),
  put: <T = Record<string, unknown>>(path: string, body?: unknown): Promise<ApiResult<T>> =>
    send<T>('PUT', path, body ?? {}),
  del: <T = Record<string, unknown>>(path: string): Promise<ApiResult<T>> => send<T>('DELETE', path),
  upload: async <T = Record<string, unknown>>(
    path: string,
    file: File,
  ): Promise<ApiResult<T>> => {
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(path, {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      });
      const text = await response.text();
      const parsed = (text === '' ? {} : JSON.parse(text)) as T;
      return { ok: response.ok, status: response.status, body: parsed, networkError: false };
    } catch {
      return { ok: false, status: 0, body: {} as T, networkError: true };
    }
  },
};

export function newIdempotencyKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
