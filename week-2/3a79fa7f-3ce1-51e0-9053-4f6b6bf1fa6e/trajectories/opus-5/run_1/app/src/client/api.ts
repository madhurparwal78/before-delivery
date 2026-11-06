export interface ApiResult<T> {
  ok: boolean;
  status: number;
  body: T;
  retryAfter: number | null;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

let serverSkewMs = 0;

/** The server clock, read from the Date header, so time edges hold under a controlled clock. */
export function serverNow(): number {
  return Date.now() + serverSkewMs;
}

export async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  const init: RequestInit = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    return {
      ok: false,
      status: 0,
      body: { error: 'internal_error', message: 'Something went wrong. Please try again.' } as T,
      retryAfter: null,
    };
  }
  const dateHeader = response.headers.get('Date');
  if (dateHeader) {
    const parsed = Date.parse(dateHeader);
    if (!Number.isNaN(parsed)) serverSkewMs = parsed - Date.now();
  }
  const text = await response.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { error: 'internal_error', message: 'Something went wrong. Please try again.' };
  }
  const retryAfter = response.headers.get('Retry-After');
  return {
    ok: response.ok,
    status: response.status,
    body: parsed as T,
    retryAfter: retryAfter === null ? null : Number(retryAfter),
  };
}

export const get = <T>(path: string): Promise<ApiResult<T>> => call<T>('GET', path);
export const post = <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResult<T>> =>
  call<T>('POST', path, body ?? {}, headers);
export const patch = <T>(path: string, body?: unknown): Promise<ApiResult<T>> => call<T>('PATCH', path, body ?? {});
export const del = <T>(path: string): Promise<ApiResult<T>> => call<T>('DELETE', path);

export function errorBody(result: ApiResult<unknown>): ApiErrorBody {
  const body = result.body as ApiErrorBody;
  if (body && typeof body.message === 'string') return body;
  return { error: 'internal_error', message: 'Something went wrong. Please try again.' };
}
