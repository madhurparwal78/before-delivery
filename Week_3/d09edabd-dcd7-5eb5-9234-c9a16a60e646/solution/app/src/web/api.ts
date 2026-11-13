export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.error ?? status));
  }

  get code(): string {
    return String(this.body.error ?? '');
  }

  /** The first validation message of a 422, if there is one. */
  get fieldErrors(): Record<string, string> {
    return (this.body.errors as Record<string, string> | undefined) ?? {};
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Raw body (a Blob or FormData) instead of JSON. */
  raw?: BodyInit;
}

/** One fetch wrapper for the whole app: JSON in and out, refusals thrown as ApiFailure, network failures as TypeError. */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined = options.raw;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(path, { method: options.method ?? 'GET', headers, body, credentials: 'same-origin' });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) throw new ApiFailure(response.status, parsed);
  return parsed as T;
}

export const get = <T>(path: string): Promise<T> => request<T>(path);
export const post = <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> => request<T>(path, { method: 'POST', body: body ?? {}, headers });
export const patch = <T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> => request<T>(path, { method: 'PATCH', body, headers });
export const del = <T>(path: string, headers?: Record<string, string>): Promise<T> => request<T>(path, { method: 'DELETE', headers });
