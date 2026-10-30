export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly fieldErrors: Record<string, string> | null,
    readonly payload: Record<string, unknown>,
  ) {
    super(code ?? `HTTP ${status}`);
    this.name = 'ApiFailure';
  }
}

export class NetworkFailure extends Error {
  constructor() {
    super('We couldn\u2019t reach Credwell. Check your connection and try again.');
    this.name = 'NetworkFailure';
  }
}

export const NETWORK_MESSAGE = 'We couldn\u2019t reach Credwell. Check your connection and try again.';

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly ifMatch?: number;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotencyKey !== undefined) headers['idempotency-key'] = options.idempotencyKey;
  if (options.ifMatch !== undefined) headers['if-match'] = `"${options.ifMatch}"`;
  try {
    return await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new NetworkFailure();
  }
}

function fieldErrorsOf(payload: Record<string, unknown>): Record<string, string> | null {
  const errors = payload['errors'];
  if (typeof errors !== 'object' || errors === null) return null;
  const out: Record<string, string> = {};
  for (const [field, message] of Object.entries(errors)) {
    if (typeof message === 'string') out[field] = message;
  }
  return out;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload: Record<string, unknown> =
    text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  if (!response.ok) {
    const code = typeof payload['error'] === 'string' ? payload['error'] : null;
    throw new ApiFailure(response.status, code, fieldErrorsOf(payload), payload);
  }
  return payload as T;
}

export function newIdempotencyKey(): string {
  return `cw-${crypto.randomUUID()}`;
}

/** Field errors come straight from the API's 422 body and sit under their field. */
export function fieldErrorOf(error: unknown, field: string): string | null {
  if (!(error instanceof ApiFailure) || error.fieldErrors === null) return null;
  return error.fieldErrors[field] ?? null;
}
