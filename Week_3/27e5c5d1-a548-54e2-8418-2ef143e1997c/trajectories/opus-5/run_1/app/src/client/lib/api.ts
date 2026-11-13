export interface ApiFailure {
  status: number;
  code: string;
  fields?: Record<string, string>;
  payload: Record<string, unknown>;
}

export class ApiCallError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.code);
  }
}

let onSignedOut: (() => void) | null = null;

export function handleSignedOut(callback: () => void): void {
  onSignedOut = callback;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  allowSignedOut?: boolean;
}

export async function call<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { ...options.headers };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload: Record<string, unknown> = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  if (response.ok) return payload as T;
  const failure: ApiFailure = {
    status: response.status,
    code: typeof payload['error'] === 'string' ? payload['error'] : 'internal',
    payload,
  };
  const fields = payload['fields'];
  if (fields !== undefined && fields !== null && typeof fields === 'object') {
    failure.fields = fields as Record<string, string>;
  }
  if (response.status === 401 && failure.code === 'signed_out' && options.allowSignedOut !== true) {
    onSignedOut?.();
  }
  throw new ApiCallError(failure);
}

export async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
  const text = await response.text();
  const payload: Record<string, unknown> = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  if (response.ok) return payload as T;
  const failure: ApiFailure = {
    status: response.status,
    code: typeof payload['error'] === 'string' ? payload['error'] : 'internal',
    payload,
  };
  const fields = payload['fields'];
  if (fields !== undefined && fields !== null && typeof fields === 'object') {
    failure.fields = fields as Record<string, string>;
  }
  if (response.status === 401 && failure.code === 'signed_out') onSignedOut?.();
  throw new ApiCallError(failure);
}

export function failureOf(error: unknown): ApiFailure | null {
  return error instanceof ApiCallError ? error.failure : null;
}
