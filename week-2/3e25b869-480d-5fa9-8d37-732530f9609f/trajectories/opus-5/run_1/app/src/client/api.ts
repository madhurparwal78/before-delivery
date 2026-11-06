import type { ApiErrorBody } from '../shared/types.js';

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly fields: Record<string, string>;
  readonly retryAfter: number | null;

  constructor(status: number, body: ApiErrorBody | null, retryAfter: number | null) {
    super(body?.error.code ?? 'network');
    this.status = status;
    this.code = body?.error.code ?? 'network';
    this.detail = body?.error.message ?? '';
    this.fields = body?.error.fields ?? {};
    this.retryAfter = retryAfter;
  }
}

type Options = { body?: unknown; idempotencyKey?: string; ifMatch?: string };

async function send<T>(method: string, path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  if (options.ifMatch) headers['If-Match'] = `"${options.ifMatch}"`;
  const init: RequestInit = { method, headers, credentials: 'same-origin' };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiFailure(0, null, null);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    const header = response.headers.get('Retry-After');
    throw new ApiFailure(
      response.status,
      parsed as ApiErrorBody | null,
      header === null ? null : Number(header),
    );
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => send<T>('GET', path),
  post: <T>(path: string, body?: unknown, options: Omit<Options, 'body'> = {}): Promise<T> =>
    send<T>('POST', path, { ...options, body: body ?? {} }),
  put: <T>(path: string, body: unknown): Promise<T> => send<T>('PUT', path, { body }),
  patch: <T>(path: string, body: unknown): Promise<T> => send<T>('PATCH', path, { body }),
  delete: <T>(path: string): Promise<T> => send<T>('DELETE', path),
};

export function newIdempotencyKey(): string {
  return `pdl-${crypto.randomUUID().replace(/-/g, '')}`.slice(0, 40);
}
