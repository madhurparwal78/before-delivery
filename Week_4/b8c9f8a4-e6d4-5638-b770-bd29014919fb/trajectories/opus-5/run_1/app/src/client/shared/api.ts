import type { ApiError } from '../../shared/types';

export class ApiRefusal extends Error {
  readonly status: number;
  readonly body: ApiError;

  constructor(status: number, body: ApiError) {
    super(body.message);
    this.status = status;
    this.body = body;
  }

  get code(): string {
    return this.body.error;
  }

  fieldError(field: string): string | undefined {
    return this.body.errors?.[field];
  }
}

/** No reply at all, or a 5xx, which the dialogs treat as a lost reply. */
export class ApiUnreachable extends Error {
  readonly status: number | null;

  constructor(status: number | null) {
    super('That could not be sent');
    this.status = status;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  ifMatch?: number;
  signal?: AbortSignal;
}

const parseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

export const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey !== undefined) headers['Idempotency-Key'] = options.idempotencyKey;
  if (options.ifMatch !== undefined) headers['If-Match'] = `"${options.ifMatch}"`;

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      credentials: 'same-origin',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiUnreachable(null);
  }

  if (response.ok) return (await parseBody(response)) as T;
  return refusalOf(response);
};

/** A reply the server explained is a refusal; anything else is a lost reply. */
const refusalOf = async (response: Response): Promise<never> => {
  const body = (await parseBody(response)) as ApiError | null;
  if (body !== null && typeof body.error === 'string') throw new ApiRefusal(response.status, body);
  throw new ApiUnreachable(response.status);
};

export const requestForm = async <T>(path: string, form: FormData): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
  } catch {
    throw new ApiUnreachable(null);
  }
  if (response.ok) return (await parseBody(response)) as T;
  return refusalOf(response);
};

export const newIdempotencyKey = (): string => crypto.randomUUID();
