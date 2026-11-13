export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
  extra: Record<string, unknown>;
}

export class ApiCallFailed extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.message);
  }
}

export interface CallOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function call<T>(path: string, options: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiCallFailed({
      status: 0,
      code: 'network',
      message: 'The press could not be reached.',
      extra: {},
    });
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  if (!response.ok) {
    const error = (parsed.error ?? {}) as { code?: string; message?: string; fields?: Record<string, string> };
    const extra = { ...parsed };
    delete extra.error;
    throw new ApiCallFailed({
      status: response.status,
      code: error.code ?? 'not_found',
      message: error.message ?? '',
      ...(error.fields ? { fields: error.fields } : {}),
      extra,
    });
  }
  return parsed as T;
}

export async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
  const text = await response.text();
  const parsed = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  if (!response.ok) {
    const error = (parsed.error ?? {}) as { code?: string; message?: string };
    throw new ApiCallFailed({
      status: response.status,
      code: error.code ?? 'not_found',
      message: error.message ?? '',
      extra: {},
    });
  }
  return parsed as T;
}
