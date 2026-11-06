export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly errors: Record<string, string> = {},
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }

  get retryAfterSeconds(): number {
    return Number(this.extra.retry_after_seconds ?? 1);
  }
}

export interface ApiResponse<T> {
  status: number;
  body: T;
  headers: Headers;
}

async function send<T>(method: string, path: string, options: { body?: unknown; headers?: Record<string, string> } = {}): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (method !== 'GET' && method !== 'HEAD') headers['X-Requested-With'] = 'farshore';
  let payload: BodyInit | undefined;
  if (options.body instanceof Blob || options.body instanceof ArrayBuffer) payload = options.body as BodyInit;
  else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }
  const response = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  const text = await response.text();
  let parsed: unknown = null;
  if (text !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) {
    const failure = (parsed ?? {}) as { error?: string; message?: string; errors?: Record<string, string> };
    throw new ApiFailure(
      response.status,
      failure.error ?? 'service_unavailable',
      failure.message ?? 'Something went wrong.',
      failure.errors ?? {},
      (parsed ?? {}) as Record<string, unknown>,
    );
  }
  return { status: response.status, body: parsed as T, headers: response.headers };
}

export const api = {
  get: <T>(path: string): Promise<ApiResponse<T>> => send<T>('GET', path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResponse<T>> =>
    send<T>('POST', path, { body: body ?? {}, headers }),
  put: <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResponse<T>> =>
    send<T>('PUT', path, { body, headers }),
  patch: <T>(path: string, body?: unknown): Promise<ApiResponse<T>> => send<T>('PATCH', path, { body }),
  delete: <T>(path: string, body?: unknown): Promise<ApiResponse<T>> => send<T>('DELETE', path, { body }),
  putBytes: <T>(path: string, bytes: Blob, headers: Record<string, string>): Promise<ApiResponse<T>> =>
    send<T>('PUT', path, { body: bytes, headers }),
};

export function queryOf(key: string, value: string | null): string {
  return value === null || value === '' ? '' : `${key}=${encodeURIComponent(value)}`;
}

export function buildQuery(parts: (string | null)[]): string {
  const kept = parts.filter((part) => part !== null && part !== '') as string[];
  return kept.length === 0 ? '' : `?${kept.join('&')}`;
}
