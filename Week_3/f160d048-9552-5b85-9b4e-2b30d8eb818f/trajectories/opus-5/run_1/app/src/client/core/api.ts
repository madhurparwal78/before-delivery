export interface ApiFailure {
  status: number;
  error: string;
  message: string;
  fields?: Record<string, string>;
  field?: string;
}

export class ApiRequestError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiRequestError';
    this.failure = failure;
  }
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function send(method: string, path: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(path, { method, credentials: 'same-origin', ...init });
  const body = await parse(response);
  if (response.ok) return body;
  const failure = (body ?? {}) as Partial<ApiFailure>;
  throw new ApiRequestError({
    status: response.status,
    error: failure.error ?? 'not_found',
    message: failure.message ?? 'We could not find that.',
    ...(failure.fields ? { fields: failure.fields } : {}),
    ...(failure.field ? { field: failure.field } : {}),
  });
}

export function get<T>(path: string): Promise<T> {
  return send('GET', path, {}) as Promise<T>;
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return send('POST', path, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body ?? {}),
  }) as Promise<T>;
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return send('PATCH', path, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  }) as Promise<T>;
}

export function put<T>(path: string, body?: BodyInit, headers: Record<string, string> = {}): Promise<T> {
  return send('PUT', path, body === undefined ? {} : { body, headers }) as Promise<T>;
}

export function remove<T>(path: string): Promise<T> {
  return send('DELETE', path, {}) as Promise<T>;
}

export function postForm<T>(path: string, form: FormData, headers: Record<string, string>): Promise<T> {
  return send('POST', path, { headers, body: form }) as Promise<T>;
}

export function failureOf(error: unknown): ApiFailure | null {
  return error instanceof ApiRequestError ? error.failure : null;
}
