export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  fieldErrors: Record<string, string> | null;
  blockers: Array<{ roomId: string; roomNumber: string; text: string }> | null;
}

interface CallOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function call<T>(path: string, options: CallOptions = {}): Promise<ApiResult<T>> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    return {
      ok: false,
      status: 0,
      data: null,
      error: 'The desk could not reach the server.',
      fieldErrors: null,
      blockers: null,
    };
  }
  if (response.status === 204) {
    return { ok: true, status: 204, data: null, error: null, fieldErrors: null, blockers: null };
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return {
      ok: response.ok,
      status: response.status,
      data: null,
      error: response.ok ? null : 'Not found.',
      fieldErrors: null,
      blockers: null,
    };
  }
  const payload = (await response.json()) as Record<string, unknown>;
  if (response.ok) {
    return {
      ok: true,
      status: response.status,
      data: payload as T,
      error: null,
      fieldErrors: null,
      blockers: null,
    };
  }
  return {
    ok: false,
    status: response.status,
    data: null,
    error: typeof payload.error === 'string' ? payload.error : null,
    fieldErrors:
      payload.errors && typeof payload.errors === 'object'
        ? (payload.errors as Record<string, string>)
        : null,
    blockers: Array.isArray(payload.blockers)
      ? (payload.blockers as Array<{ roomId: string; roomNumber: string; text: string }>)
      : null,
  };
}

export async function upload<T>(path: string, form: FormData): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
  } catch {
    return {
      ok: false,
      status: 0,
      data: null,
      error: 'The desk could not reach the server.',
      fieldErrors: null,
      blockers: null,
    };
  }
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: response.ok,
    status: response.status,
    data: response.ok ? (payload as T) : null,
    error: typeof payload.error === 'string' ? payload.error : null,
    fieldErrors:
      payload.errors && typeof payload.errors === 'object'
        ? (payload.errors as Record<string, string>)
        : null,
    blockers: null,
  };
}

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}
