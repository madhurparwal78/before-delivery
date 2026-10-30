export interface ApiFailure {
  status: number;
  error?: string;
  errors?: Record<string, string>;
  body: Record<string, unknown>;
}

export class ApiCallError extends Error implements ApiFailure {
  readonly status: number;
  readonly error?: string;
  readonly errors?: Record<string, string>;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === 'string' ? body.error : 'request failed');
    this.status = status;
    this.body = body;
    if (typeof body.error === 'string') this.error = body.error;
    if (body.errors !== null && typeof body.errors === 'object') {
      this.errors = body.errors as Record<string, string>;
    }
  }

  get service(): 'billing' | 'file_storage' | null {
    const service = this.body.service;
    return service === 'billing' || service === 'file_storage' ? service : null;
  }
}

type Listener = (failure: ApiCallError) => void;
const outageListeners = new Set<Listener>();

export function onOutage(listener: Listener): () => void {
  outageListeners.add(listener);
  return () => outageListeners.delete(listener);
}

async function parse(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('application/json')) return (await response.json()) as unknown;
  return null;
}

export async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string>; raw?: BodyInit } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined = options.raw;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  if (response.status === 204) return undefined as T;
  const payload = await parse(response);
  if (!response.ok) {
    const failure = new ApiCallError(
      response.status,
      (payload ?? {}) as Record<string, unknown>,
    );
    if (failure.status === 503) {
      for (const listener of outageListeners) listener(failure);
    }
    throw failure;
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> =>
    request<T>('POST', path, { body: body ?? {}, headers }),
  patch: <T>(path: string, body: unknown): Promise<T> => request<T>('PATCH', path, { body }),
  del: <T>(path: string): Promise<T> => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData): Promise<T> => request<T>('POST', path, { raw: form }),
  put: <T>(path: string, raw: BodyInit, headers?: Record<string, string>): Promise<T> =>
    request<T>('PUT', path, { raw, headers }),
};

export function idempotencyKey(prefix: string): Record<string, string> {
  const random = crypto.getRandomValues(new Uint8Array(12));
  const suffix = [...random].map((byte) => byte.toString(36)).join('');
  return { 'Idempotency-Key': `${prefix}-${suffix}` };
}
