export type ApiError = { error: string; message: string; field?: string };

export class RequestFailed extends Error {
  readonly status: number;
  readonly code: string;
  readonly field?: string;

  constructor(status: number, payload: ApiError) {
    super(payload.message);
    this.status = status;
    this.code = payload.error;
    this.field = payload.field;
  }
}

/** A request that never answered at all, so the caller may resend it once. */
export class NoResponse extends Error {}

export async function api<T>(
  method: string,
  path: string,
  payload?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      credentials: 'same-origin',
    });
  } catch {
    throw new NoResponse('no response');
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    throw new RequestFailed(response.status, (parsed ?? { error: 'not_found', message: '' }) as ApiError);
  }
  return parsed as T;
}

export function get<T>(path: string): Promise<T> {
  return api<T>('GET', path);
}

export async function upload<T>(
  path: string,
  form: FormData,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
  } catch {
    throw new NoResponse('no response');
  }
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    throw new RequestFailed(response.status, (parsed ?? { error: 'not_found', message: '' }) as ApiError);
  }
  return parsed as T;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
