import type { ApiErrorBody } from '../shared/api.js';

export class ApiFailure extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiFailure';
    this.status = status;
    this.body = body;
  }

  get code(): string {
    return this.body.error;
  }
}

let keyCounter = 0;

export function idempotencyKey(prefix: string): string {
  keyCounter += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${keyCounter}-${random}`;
}

interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly form?: FormData;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.idempotencyKey !== undefined) headers['Idempotency-Key'] = options.idempotencyKey;
  let body: BodyInit | undefined;
  if (options.form !== undefined) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(path, {
    method: options.method ?? (body === undefined ? 'GET' : 'POST'),
    headers,
    body,
    credentials: 'same-origin',
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text === '' ? {} : JSON.parse(text);
  if (!response.ok) {
    throw new ApiFailure(response.status, parsed as ApiErrorBody);
  }
  return { ...(parsed as object), __status: response.status } as T;
}

export function statusOf(value: unknown): number {
  const status = (value as { __status?: number }).__status;
  return status ?? 200;
}
