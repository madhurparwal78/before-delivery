export interface ApiResult<T> {
  readonly ok: boolean;
  readonly status: number;
  readonly data: T;
  readonly headers: Headers;
}

export interface ApiFailure {
  readonly error?: string;
  readonly errors?: Record<string, string>;
  readonly [key: string]: unknown;
}

export async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  let data: unknown = null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) data = await response.json();
  else if (response.status !== 204) data = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    data: data as T,
    headers: response.headers,
  };
}

export const api = {
  get: <T>(path: string): Promise<ApiResult<T>> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<ApiResult<T>> => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown): Promise<ApiResult<T>> => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown): Promise<ApiResult<T>> => request<T>('PATCH', path, body),
  delete: <T>(path: string): Promise<ApiResult<T>> => request<T>('DELETE', path),
};

export function failure(result: ApiResult<unknown>): ApiFailure {
  const data = result.data;
  return data !== null && typeof data === 'object' ? (data as ApiFailure) : {};
}
