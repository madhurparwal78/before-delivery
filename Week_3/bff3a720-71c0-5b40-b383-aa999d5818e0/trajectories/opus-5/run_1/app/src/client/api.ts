export interface Failure {
  status: number;
  error: string;
  message: string;
  fields?: Record<string, string>;
  retryAfterSeconds?: number;
  ride?: unknown;
}

export type Result<T> = { ok: true; data: T } | { ok: false; failure: Failure };

export interface RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
  ifMatch?: number;
  form?: FormData;
}

function failureFrom(status: number, payload: unknown, retryAfter: string | null): Failure {
  const record = (payload ?? {}) as Record<string, unknown>;
  return {
    status,
    error: typeof record.error === 'string' ? record.error : 'not_found',
    message: typeof record.message === 'string' ? record.message : 'We could not find that.',
    fields: (record.fields as Record<string, string> | undefined) ?? undefined,
    retryAfterSeconds: retryAfter ? Number(retryAfter) : undefined,
    ride: record.ride,
  };
}

export async function api<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<Result<T>> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  if (options.ifMatch !== undefined) headers['If-Match'] = String(options.ifMatch);

  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    return {
      ok: false,
      failure: {
        status: 503,
        error: 'storage_unavailable',
        message: 'We could not store your file right now. Nothing was lost; try again in a moment.',
      },
    };
  }
  if (response.status === 204) return { ok: true, data: undefined as T };
  const contentType = response.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text();
  if (!response.ok) {
    return {
      ok: false,
      failure: failureFrom(response.status, payload, response.headers.get('retry-after')),
    };
  }
  return { ok: true, data: payload as T };
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
