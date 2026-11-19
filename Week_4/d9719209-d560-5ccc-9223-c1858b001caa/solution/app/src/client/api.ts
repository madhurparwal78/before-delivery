import type { ErrorBody } from '../shared/types.js';

/** A refusal or failure from the API, in the shared error shape (code NETWORK when no response came back). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly retryAfter: number | null;
  readonly current: Record<string, unknown> | null;

  constructor(status: number, code: string, message: string, extra: Partial<ErrorBody['error']> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = extra.fields ?? {};
    this.retryAfter = extra.retryAfter ?? null;
    this.current = extra.current ?? null;
  }
}

async function failure(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ErrorBody;
    return new ApiError(response.status, body.error.code, body.error.message, body.error);
  } catch {
    return new ApiError(response.status, 'UNKNOWN', 'Something went wrong');
  }
}

async function send<T>(method: string, path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method, credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError(0, 'NETWORK', 'The network is unavailable');
  }
  if (!response.ok) throw await failure(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface CallOptions { key?: string }

/** One JSON request; `key` sets the Idempotency-Key header that post and comment creation need. */
export function api<T>(method: string, path: string, body?: unknown, options: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.key !== undefined) headers['Idempotency-Key'] = options.key;
  return send<T>(method, path, { headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

export const get = <T>(path: string): Promise<T> => api<T>('GET', path);

export function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  return send<T>('POST', path, { body: form });
}

/** A fresh Idempotency-Key: 1 to 100 visible ASCII characters. */
export const newKey = (): string => crypto.randomUUID();

export function query(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}
