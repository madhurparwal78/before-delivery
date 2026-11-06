import type { ApiErrorBody } from '../../shared/types';
import { setServerNow } from './serverClock';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly alternatives?: ApiErrorBody['alternatives'],
    readonly quote?: ApiErrorBody['quote'],
    readonly photoIndex?: number,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

export class NetworkFailure extends Error {}

interface RequestOptions {
  method?: string;
  body?: unknown;
  form?: FormData;
  idempotencyKey?: string;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: string | FormData | undefined;
  if (options.form !== undefined) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey !== undefined) headers['Idempotency-Key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body,
      credentials: 'same-origin',
    });
  } catch {
    throw new NetworkFailure('network');
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) throw new NetworkFailure('not json');
    return undefined as T;
  }
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    if (response.status >= 500 && response.status !== 503) throw new NetworkFailure('server');
    const failure = payload as ApiErrorBody;
    throw new ApiFailure(
      response.status,
      failure.error?.code ?? 'error',
      failure.error?.message ?? 'Something went wrong.',
      failure.fields,
      failure.alternatives,
      failure.quote,
      failure.photo_index,
    );
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.server_now === 'string') setServerNow(record.server_now);
  return payload as T;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
