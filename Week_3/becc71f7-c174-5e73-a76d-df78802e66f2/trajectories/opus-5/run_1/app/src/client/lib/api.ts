export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  fields: Record<string, string>;
}

export class ApiError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiError';
  }
}

export const SESSION_ENDED_EVENT = 'ourlet:session-ended';

export interface CallOptions {
  body?: unknown;
  raw?: BodyInit;
  contentType?: string;
  headers?: Record<string, string>;
}

/** Every call goes to the app itself, so the browser sends the session cookie. */
export async function call<T>(method: string, path: string, options: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.contentType !== undefined) headers['content-type'] = options.contentType;

  const response = await fetch(path, {
    method,
    headers,
    body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text === '' ? null : safeJson(text);

  if (!response.ok) {
    const error = (parsed as { error?: Partial<ApiFailure> } | null)?.error ?? {};
    const failure: ApiFailure = {
      status: response.status,
      code: error.code ?? 'unknown',
      message: error.message ?? 'Something went wrong.',
      fields: error.fields ?? {},
    };
    if (failure.code === 'session_ended' || failure.code === 'unauthenticated') {
      window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: failure }));
    }
    throw new ApiError(failure);
  }

  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const get = <T>(path: string): Promise<T> => call<T>('GET', path);
export const post = <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> =>
  call<T>('POST', path, { ...(body === undefined ? {} : { body }), ...(headers === undefined ? {} : { headers }) });
export const put = <T>(path: string, body: unknown): Promise<T> => call<T>('PUT', path, { body });
export const patch = <T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> =>
  call<T>('PATCH', path, { body, ...(headers === undefined ? {} : { headers }) });
export const del = <T>(path: string): Promise<T> => call<T>('DELETE', path);

/** Downloads a file the app serves, keeping it on the same origin. */
export async function download(path: string): Promise<void> {
  const response = await fetch(path);
  if (!response.ok) {
    const text = await response.text();
    const error = (safeJson(text) as { error?: Partial<ApiFailure> } | null)?.error ?? {};
    const failure: ApiFailure = {
      status: response.status,
      code: error.code ?? 'unknown',
      message: error.message ?? 'Something went wrong.',
      fields: error.fields ?? {},
    };
    if (failure.code === 'session_ended' || failure.code === 'unauthenticated') {
      window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: failure }));
    }
    throw new ApiError(failure);
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'download';
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
