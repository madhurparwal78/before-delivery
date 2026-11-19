export interface ApiResult<T> {
  status: number;
  ok: boolean;
  body: T;
}

export interface ApiFailure {
  error?: string;
  message?: string;
  errors?: Record<string, string>;
  current?: Record<string, unknown>;
  state?: string;
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  const response = await fetch(path, {
    method,
    headers:
      body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const text = await response.text();
  const parsed = (text === '' ? {} : JSON.parse(text)) as T;
  return { status: response.status, ok: response.ok, body: parsed };
}

export const api = {
  get: <T>(path: string): Promise<ApiResult<T>> => call<T>('GET', path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResult<T>> =>
    call<T>('POST', path, body ?? {}, headers),
  patch: <T>(path: string, body: unknown): Promise<ApiResult<T>> => call<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown): Promise<ApiResult<T>> => call<T>('PUT', path, body),
  remove: <T>(path: string): Promise<ApiResult<T>> => call<T>('DELETE', path, {}),
  upload: async <T>(path: string, file: File, fieldName = 'file'): Promise<ApiResult<T>> => {
    const form = new FormData();
    form.append(fieldName, file);
    const response = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
    const text = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      body: (text === '' ? {} : JSON.parse(text)) as T,
    };
  },
};

/** The one place a refusal becomes the line a person reads. */
export function refusalText(result: ApiResult<ApiFailure>): string {
  const body = result.body;
  if (body.message !== undefined) return body.message;
  if (body.errors !== undefined) return Object.values(body.errors)[0] ?? 'That did not work';
  if (body.error === 'version_conflict') return 'That swatch changed first';
  if (body.error === 'not_found') return 'That is not here';
  if (body.error === 'unauthenticated') return 'Sign in to carry on';
  return 'That did not work';
}
