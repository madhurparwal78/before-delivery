export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
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
    const error =
      typeof parsed === 'object' && parsed !== null && typeof (parsed as { error?: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : 'Something went wrong.';
    return { ok: false, status: response.status, data: null, error };
  }
  return { ok: true, status: response.status, data: parsed as T, error: null };
}

export const api = {
  get: <T>(path: string): Promise<ApiResult<T>> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<ApiResult<T>> => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown): Promise<ApiResult<T>> => request<T>('PUT', path, body),
  remove: <T>(path: string): Promise<ApiResult<T>> => request<T>('DELETE', path)
};

export const OUTAGE_TEXT = {
  valkey: 'Live rooms are unavailable right now.',
  storageWrite: 'File storage is unavailable. Nothing was saved.'
} as const;
