export interface ApiFailure {
  status: number;
  body: Record<string, unknown>;
}

export class ApiCallError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(String(failure.body.error ?? failure.status));
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  if (!response.ok) throw new ApiCallError({ status: response.status, body: parsed });
  return parsed as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => call<T>('GET', path),
  post: <T>(path: string, body: unknown): Promise<T> => call<T>('POST', path, body),
  patch: <T>(path: string, body: unknown): Promise<T> => call<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown): Promise<T> => call<T>('PUT', path, body),
  del: <T>(path: string): Promise<T> => call<T>('DELETE', path),
};
