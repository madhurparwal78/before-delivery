export interface ApiAnswer<T> {
  status: number;
  body: T;
  ok: boolean;
  /** True when the request never reached the server. */
  offline: boolean;
  retryAfter: number | null;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  accept?: string,
): Promise<ApiAnswer<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (accept) headers.accept = accept;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    return { status: 0, body: null as T, ok: false, offline: true, retryAfter: null };
  }
  const retryAfterHeader = response.headers.get('retry-after');
  const type = response.headers.get('content-type') ?? '';
  let parsed: unknown = null;
  if (type.includes('application/json')) {
    parsed = await response.json().catch(() => null);
  } else if (type.startsWith('text/')) {
    parsed = await response.text().catch(() => null);
  } else {
    await response.arrayBuffer().catch(() => null);
  }
  return {
    status: response.status,
    body: parsed as T,
    ok: response.ok,
    offline: false,
    retryAfter: retryAfterHeader === null ? null : Number(retryAfterHeader),
  };
}

export const api = {
  get: <T>(path: string): Promise<ApiAnswer<T>> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<ApiAnswer<T>> =>
    request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown): Promise<ApiAnswer<T>> => request<T>('PUT', path, body),
  del: <T>(path: string): Promise<ApiAnswer<T>> => request<T>('DELETE', path),
};

/** Raw bytes, for stroke files and packet PDFs. */
export async function fetchBytes(
  path: string,
): Promise<{ status: number; bytes: Uint8Array | null; text: string | null; offline: boolean }> {
  try {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) {
      await response.arrayBuffer().catch(() => null);
      return { status: response.status, bytes: null, text: null, offline: false };
    }
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    return {
      status: response.status,
      bytes,
      text: new TextDecoder().decode(bytes),
      offline: false,
    };
  } catch {
    return { status: 0, bytes: null, text: null, offline: true };
  }
}

export interface ValidationBody {
  error: string;
  fields?: Record<string, string>;
}
