import { locale } from './i18n.ts';

export type ApiFailure = {
  code: string;
  message: string;
  fields?: Record<string, string>;
  seats?: string[];
  attempts_left?: number;
  retry_after_seconds?: number;
};

export class ApiCallError extends Error {
  readonly failure: ApiFailure;
  readonly status: number;

  constructor(status: number, failure: ApiFailure) {
    super(failure.message);
    this.status = status;
    this.failure = failure;
  }
}

export async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      'X-Halide-Locale': locale(),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  if (!response.ok) {
    const failure = (parsed.error ?? { code: 'not_found', message: '' }) as ApiFailure;
    throw new ApiCallError(response.status, failure);
  }
  return parsed as T;
}

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}
