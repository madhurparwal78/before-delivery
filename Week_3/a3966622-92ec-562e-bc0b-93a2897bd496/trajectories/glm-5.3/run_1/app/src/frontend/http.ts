// HTTP access. Every keyed request carries an Idempotency-Key, and a request
// that ends without a reply is reported as such, never as a failure state.

export class NoReply extends Error {
  constructor() {
    super('No reply from the server');
  }
}

export class ApiFailure {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly message: string,
    public readonly errors?: Record<string, string>,
    public readonly extra?: Record<string, unknown>,
  ) {}
}

export type ApiResult<T> =
  | { ok: true; value: T; etag: string | null }
  | { ok: false; failure: ApiFailure }
  | { ok: false; noReply: true };

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: { key?: string; ifMatch?: string } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.key) headers['Idempotency-Key'] = opts.key;
  if (opts.ifMatch) headers['If-Match'] = opts.ifMatch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? null : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    return { ok: false, noReply: true };
  }
  clearTimeout(timer);
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (res.status >= 200 && res.status < 300) {
    return { ok: true, value: payload as T, etag: res.headers.get('etag') };
  }
  const body_ = (payload ?? {}) as { error?: string; message?: string; errors?: Record<string, string> };
  return {
    ok: false,
    failure: new ApiFailure(
      res.status,
      body_.error ?? 'unknown',
      body_.message ?? '',
      body_.errors,
      body_ as Record<string, unknown>,
    ),
  };
}

export const get = <T>(path: string) => call<T>('GET', path);
export const post = <T>(path: string, body?: unknown, opts?: { key?: string; ifMatch?: string }) => call<T>('POST', path, body, opts);
export const patch = <T>(path: string, body: unknown, opts?: { ifMatch?: string }) => call<T>('PATCH', path, body, opts);
export const del = <T>(path: string) => call<T>('DELETE', path);

export function newKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Uploads raw bytes, reporting the server's stored record.
export async function uploadPhoto(moveRef: string, bytes: Uint8Array, contentType: string): Promise<ApiResult<{ photo_id: string; sha256: string; size_bytes: number; key: string }>> {
  const res = await fetch(`/api/moves/${moveRef}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: new Uint8Array(bytes),
  });
  if (res.status >= 200 && res.status < 300) {
    return { ok: true, value: await res.json() as { photo_id: string; sha256: string; size_bytes: number; key: string }, etag: null };
  }
  const failure = await res.json().catch(() => ({ error: 'unknown', message: '' })) as { error?: string; message?: string };
  return { ok: false, failure: new ApiFailure(res.status, failure.error ?? 'unknown', failure.message ?? '') };
}
