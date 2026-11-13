export interface ApiFailure {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  failure: ApiFailure | null;
}

async function send<T>(method: string, path: string, options: { body?: BodyInit; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method,
      headers: options.headers ?? {},
      body: options.body,
      credentials: 'same-origin'
    });
    const text = await response.text();
    const parsed = text === '' ? null : (JSON.parse(text) as unknown);
    if (response.ok) return { ok: true, status: response.status, data: parsed as T, failure: null };
    const failure = (parsed ?? { error: 'unknown', message: 'Something went wrong. Try again.' }) as ApiFailure;
    return { ok: false, status: response.status, data: null, failure };
  } catch {
    return {
      ok: false,
      status: 0,
      data: null,
      failure: { error: 'network', message: 'Something went wrong. Try again.' }
    };
  }
}

export const getJson = <T>(path: string): Promise<ApiResult<T>> => send<T>('GET', path);

export const postJson = <T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> =>
  send<T>('POST', path, { body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });

export const postRaw = <T>(path: string, body: BodyInit, contentType: string): Promise<ApiResult<T>> =>
  send<T>('POST', path, { body, headers: { 'content-type': contentType } });

export const putJson = <T>(path: string, body: unknown): Promise<ApiResult<T>> =>
  send<T>('PUT', path, { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

export const deleteJson = <T>(path: string): Promise<ApiResult<T>> => send<T>('DELETE', path);
