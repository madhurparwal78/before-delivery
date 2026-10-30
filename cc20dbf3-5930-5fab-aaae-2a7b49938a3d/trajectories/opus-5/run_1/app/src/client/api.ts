import type { ApiErrorBody, ErrorCode } from '../shared/errors.js';

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'network';
  readonly fields: Record<string, string>;

  constructor(status: number, code: ErrorCode | 'network', message: string, fields: Record<string, string>) {
    super(message);
    this.name = 'ApiFailure';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly form?: FormData;
  readonly idempotencyKey?: string;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.form !== undefined) body = options.form;
  else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey !== undefined) headers['idempotency-key'] = options.idempotencyKey;
  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    credentials: 'same-origin',
  };
  if (body !== undefined) init.body = body;
  return fetch(path, init);
}

async function failureFrom(response: Response): Promise<ApiFailure> {
  let parsed: ApiErrorBody | null = null;
  try {
    parsed = (await response.json()) as ApiErrorBody;
  } catch {
    parsed = null;
  }
  const error = parsed?.error;
  return new ApiFailure(
    response.status,
    error?.code ?? 'not_found',
    error?.message ?? 'Not found.',
    error?.fields ?? {},
  );
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await send(path, options);
  } catch {
    /* The browser retries a keyed request once with the same key when the network drops. */
    if (options.idempotencyKey === undefined) {
      throw new ApiFailure(0, 'network', 'The network dropped. Try again.', {});
    }
    try {
      response = await send(path, options);
    } catch {
      throw new ApiFailure(0, 'network', 'The network dropped. Try again.', {});
    }
  }
  if (!response.ok) throw await failureFrom(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function freshKey(): string {
  return crypto.randomUUID();
}
