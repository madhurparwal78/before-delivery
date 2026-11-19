export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown>,
  ) {
    super(code);
  }

  field(name: string): string | null {
    const errors = this.body.errors;
    if (errors === null || typeof errors !== 'object') return null;
    const value = (errors as Record<string, unknown>)[name];
    return typeof value === 'string' ? value : null;
  }

}

/** A request that never reached an answer. */
export class NetworkFailure extends Error {}

interface RequestOptions {
  method?: string;
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined;
  if (options.form !== undefined) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body,
      credentials: 'same-origin',
    });
  } catch {
    throw new NetworkFailure(path);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text === '' ? {} : JSON.parse(text);
  const value = (parsed ?? {}) as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof value.error === 'string' ? value.error : 'internal';
    throw new ApiFailure(response.status, code, value);
  }
  return value as T;
}
