import type { ApiErrorBody } from '../shared/types.js';

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiFailure';
    this.status = status;
    this.code = body.error;
    this.fields = body.fields ?? {};
  }
}

interface RequestOptions {
  readonly method?: string;
  readonly json?: unknown;
  readonly form?: FormData;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

const parse = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

export const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.json);
  } else if (options.form !== undefined) {
    body = options.form;
  }
  if (options.idempotencyKey !== undefined) headers['idempotency-key'] = options.idempotencyKey;

  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body,
    credentials: 'same-origin',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const payload = await parse(response);
  if (!response.ok) {
    const shape = (payload ?? { error: 'internal_error', message: 'Something went wrong. Try again.' }) as ApiErrorBody;
    throw new ApiFailure(response.status, shape);
  }
  return payload as T;
};

export const newIdempotencyKey = (): string => crypto.randomUUID();
