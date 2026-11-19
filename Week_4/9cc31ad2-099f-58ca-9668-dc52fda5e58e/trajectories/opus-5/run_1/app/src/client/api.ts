export interface ApiErrorBody {
  error: { code: string; message: string };
  fields?: Record<string, string>;
}

export type ApiResult<T> =
  | { kind: 'ok'; status: number; data: T }
  | { kind: 'error'; status: number; body: ApiErrorBody }
  /** No HTTP response arrived at all: the request is unconfirmed. */
  | { kind: 'unconfirmed' };

async function send<T>(
  method: string,
  path: string,
  body?: string,
  headers?: Record<string, string>,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(headers ?? {}),
      },
      body: body ?? null,
      credentials: 'same-origin',
    });
  } catch {
    return { kind: 'unconfirmed' };
  }
  const text = await response.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : {};
  if (!response.ok) {
    return { kind: 'error', status: response.status, body: parsed as ApiErrorBody };
  }
  return { kind: 'ok', status: response.status, data: parsed as T };
}

export function apiGet<T>(path: string): Promise<ApiResult<T>> {
  return send<T>('GET', path);
}

export function apiPost<T>(
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<ApiResult<T>> {
  return send<T>('POST', path, JSON.stringify(body), headers);
}

/** Sends exact bytes, never re-serialised, for finish requests and purchase retries. */
export function apiPostRaw<T>(
  path: string,
  bytes: string,
  headers?: Record<string, string>,
): Promise<ApiResult<T>> {
  return send<T>('POST', path, bytes, headers);
}

export function apiPatch<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  return send<T>('PATCH', path, JSON.stringify(body));
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
