// Fetch wrapper. Every error body has the one published shape.
export interface ApiErrorBody { code: string; message: string; fields: Record<string, string> }
export interface ApiResult<T> { status: number; ok: boolean; body: T | null; error: ApiErrorBody | null }

export async function api<T>(method: string, path: string, body?: unknown, opts: { contentType?: string } = {}): Promise<ApiResult<T>> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    if (body instanceof FormData) {
      init.body = body;
    } else {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      init.headers = { 'Content-Type': opts.contentType ?? 'application/json' };
    }
  }
  const res = await fetch(path, init);
  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  const out: ApiResult<T> = { status: res.status, ok: res.status >= 200 && res.status < 300, body: null, error: null };
  if (parsed !== null && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (obj.error !== null && typeof obj.error === 'object') {
      const err = obj.error as Record<string, unknown>;
      out.error = { code: String(err.code ?? ''), message: String(err.message ?? ''), fields: (err.fields as Record<string, string>) ?? {} };
    } else {
      out.body = parsed as T;
    }
  }
  return out;
}

export function isUnauthenticated(result: ApiResult<unknown>): boolean {
  return result.status === 401;
}
