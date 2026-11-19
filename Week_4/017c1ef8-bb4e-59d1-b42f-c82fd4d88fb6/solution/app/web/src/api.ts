interface ApiErrorBody {
  error: string;
  [key: string]: unknown;
}

/** A refusal from the server. Network failures are not ApiErrors: they reject with the browser's TypeError. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.error);
  }

  /** The message for one field of a 422 validation body. */
  field(name: string): string | undefined {
    const fields = this.body.fields;
    if (typeof fields === 'object' && fields !== null) {
      const value = (fields as Record<string, unknown>)[name];
      return typeof value === 'string' ? value : undefined;
    }
    return undefined;
  }
}

export const newIdempotencyKey = (): string => crypto.randomUUID();

interface RequestOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
}

async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    signal: options.signal,
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text === '' ? {} : JSON.parse(text);
  if (!response.ok) throw new ApiError(response.status, parsed as ApiErrorBody);
  return parsed as T;
}

/** Multipart upload of one file in the part named `file`. */
async function upload<T>(path: string, file: Blob, name: string): Promise<T> {
  const form = new FormData();
  form.append('file', file, name);
  const response = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
  const parsed = (await response.json()) as unknown;
  if (!response.ok) throw new ApiError(response.status, parsed as ApiErrorBody);
  return parsed as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PUT', path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('PATCH', path, body, options),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, undefined, options),
  upload,
};
