export interface ApiFailure {
  code: string;
  message: string;
  retryAfter?: number;
  fields?: Record<string, string>;
  current?: Record<string, unknown>;
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: ApiFailure | null;
}

export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string>; form?: FormData } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  try {
    const response = await fetch(path, {
      method: options.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      credentials: 'same-origin',
    });
    const text = await response.text();
    const payload: unknown = text === '' ? null : JSON.parse(text);
    if (!response.ok) {
      const failure = (payload as { error?: ApiFailure } | null)?.error ?? {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Something went wrong',
      };
      return { ok: false, status: response.status, data: null, error: failure };
    }
    return { ok: true, status: response.status, data: payload as T, error: null };
  } catch {
    return {
      ok: false,
      status: 0,
      data: null,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Something went wrong' },
    };
  }
}

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
