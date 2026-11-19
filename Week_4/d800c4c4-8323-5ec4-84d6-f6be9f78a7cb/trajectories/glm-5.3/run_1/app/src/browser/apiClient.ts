// API client: fetch wrappers that surface the server's error shape.

export interface ApiErrorShape {
  status: number;
  error: string;
  fields?: Record<string, string>;
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    readonly fields: Record<string, string> | undefined,
  ) {
    super(error);
    this.name = 'ApiFailure';
  }
}

export async function apiJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const parsed: unknown = text === '' ? undefined : JSON.parse(text);
  if (!res.ok) {
    const err = parsed as { error?: string; fields?: Record<string, string> } | undefined;
    throw new ApiFailure(res.status, err?.error ?? 'Something went wrong.', err?.fields);
  }
  return parsed as T;
}

export async function apiForm<T>(method: string, path: string, form: FormData): Promise<T> {
  const res = await fetch(path, { method, body: form, credentials: 'same-origin' });
  const text = await res.text();
  const parsed: unknown = text === '' ? undefined : JSON.parse(text);
  if (!res.ok) {
    const err = parsed as { error?: string; fields?: Record<string, string> } | undefined;
    throw new ApiFailure(res.status, err?.error ?? 'Something went wrong.', err?.fields);
  }
  return parsed as T;
}
