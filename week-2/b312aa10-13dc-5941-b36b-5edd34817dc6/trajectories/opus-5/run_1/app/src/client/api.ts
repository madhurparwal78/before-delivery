/** Every call to the Lineboard server, with retries, and session handover. */

export type ApiResult<T> = {
  status: number;
  body: T;
  headers: Headers;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly copy: string;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(String(body['error'] ?? 'error'));
    this.status = status;
    this.code = String(body['error'] ?? 'error');
    this.copy = String(body['message'] ?? '');
    this.body = body;
  }

  fieldErrors(): Record<string, string> {
    const errors = this.body['errors'];
    return typeof errors === 'object' && errors !== null
      ? (errors as Record<string, string>)
      : {};
  }

  firstFieldMessage(): string | null {
    const values = Object.values(this.fieldErrors());
    return values.length > 0 ? String(values[0]) : null;
  }
}

export class NetworkError extends Error {}

/** Thrown when the session that sent a request has ended; the response is never drawn. */
export class AbandonedError extends Error {}

export const networkCopy = 'Lineboard could not reach the server. Check the connection and try again.';

let epoch = 0;
const listeners = new Set<() => void>();

export function currentEpoch(): number {
  return epoch;
}

export function endSession(): void {
  epoch += 1;
  for (const listener of listeners) listener();
}

export function onSessionEnd(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function newIdempotencyKey(): string {
  const random = crypto.getRandomValues(new Uint8Array(16));
  return [...random].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  form?: FormData;
  idempotencyKey?: string;
  retry?: boolean;
  signal?: AbortSignal;
};

async function once<T>(path: string, options: RequestOptions): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal ?? null,
    });
  } catch (error) {
    if (options.signal?.aborted) throw new AbandonedError();
    throw new NetworkError(String(error));
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const parsed = (await response.json()) as Record<string, unknown>;
    if (!response.ok) throw new ApiError(response.status, parsed);
    return { status: response.status, body: parsed as T, headers: response.headers };
  }
  if (!response.ok) {
    throw new ApiError(response.status, { error: 'not_found', message: 'That was not found.' });
  }
  return { status: response.status, body: undefined as T, headers: response.headers };
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const sentAt = epoch;
  const attempts = options.retry ? 3 : 1;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await once<T>(path, options);
      if (sentAt !== epoch) throw new AbandonedError();
      return result;
    } catch (error) {
      if (sentAt !== epoch) throw new AbandonedError();
      if (error instanceof ApiError) {
        if (error.status === 401) {
          endSession();
          throw new AbandonedError();
        }
        throw error;
      }
      if (error instanceof AbandonedError) throw error;
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new NetworkError('failed');
}

export function get<T>(path: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  return request<T>(path, signal ? { signal } : {});
}

export function post<T>(
  path: string,
  body: unknown,
  options: { idempotencyKey?: string; retry?: boolean } = {},
): Promise<ApiResult<T>> {
  return request<T>(path, { method: 'POST', body, ...options });
}

export function put<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  return request<T>(path, { method: 'PUT', body });
}

export function patch<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  return request<T>(path, { method: 'PATCH', body });
}

export function del<T>(path: string): Promise<ApiResult<T>> {
  return request<T>(path, { method: 'DELETE' });
}

/** A retry-safe write: one fresh key per user action, resent on network failure. */
export function writeAction<T>(
  path: string,
  body: unknown,
  method: 'POST' = 'POST',
): Promise<ApiResult<T>> {
  return request<T>(path, {
    method,
    body,
    idempotencyKey: newIdempotencyKey(),
    retry: true,
  });
}
