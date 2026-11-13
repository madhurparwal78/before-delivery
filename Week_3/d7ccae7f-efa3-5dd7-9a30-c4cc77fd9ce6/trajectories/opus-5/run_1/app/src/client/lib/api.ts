export interface ApiFailure {
  status: number;
  code: string;
  fields: Record<string, string>;
  remainingMs: number | null;
  currentVersion: number | null;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; failure: ApiFailure };

function toFailure(status: number, body: unknown): ApiFailure {
  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const rawFields = record['fields'];
  const fields: Record<string, string> = {};
  if (typeof rawFields === 'object' && rawFields !== null) {
    for (const [key, value] of Object.entries(rawFields)) {
      if (typeof value === 'string') fields[key] = value;
    }
  }
  return {
    status,
    code: typeof record['error'] === 'string' ? record['error'] : 'request_failed',
    fields,
    remainingMs: typeof record['remainingMs'] === 'number' ? record['remainingMs'] : null,
    currentVersion: typeof record['currentVersion'] === 'number' ? record['currentVersion'] : null,
  };
}

async function request<T>(method: string, path: string, body?: unknown, raw?: BodyInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: raw ? undefined : body === undefined ? undefined : { 'content-type': 'application/json' },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      credentials: 'same-origin',
    });
  } catch {
    return {
      ok: false,
      failure: { status: 0, code: 'network_error', fields: {}, remainingMs: null, currentVersion: null },
    };
  }
  if (response.status === 204) return { ok: true, data: undefined as T };
  const text = await response.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : {};
  if (!response.ok) return { ok: false, failure: toFailure(response.status, parsed) };
  return { ok: true, data: parsed as T };
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, undefined, form),
};
