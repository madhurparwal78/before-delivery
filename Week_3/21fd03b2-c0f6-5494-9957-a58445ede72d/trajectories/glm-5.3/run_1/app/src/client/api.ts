export type ApiError = {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
  details?: Record<string, unknown>;
};

export type Api = {
  ok: true;
  status: number;
  body: unknown;
} | {
  ok: false;
  status: number;
  error: ApiError;
};

export async function api(method: string, path: string, body?: unknown, opts: { raw?: boolean; signal?: AbortSignal } = {}): Promise<Api> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (opts.signal) init.signal = opts.signal;
  if (body !== undefined) {
    const isBinary = body instanceof Blob || body instanceof ArrayBuffer || body instanceof Uint8Array || body instanceof DataView;
    if (opts.raw && isBinary) {
      init.body = body as BodyInit;
    } else {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new OfflineSignal();
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return res.ok ? { ok: true, status: res.status, body: null } : { ok: false, status: res.status, error: { status: res.status, code: 'unknown', message: 'Empty response.' } };
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string; fields?: Record<string, string>; details?: Record<string, unknown> } }).error;
      const apiError: ApiError = {
        status: res.status,
        code: err?.code ?? 'unknown',
        message: err?.message ?? 'Something went wrong.',
      };
      if (err?.fields) apiError.fields = err.fields;
      if (err?.details) apiError.details = err.details;
      return { ok: false, status: res.status, error: apiError };
    }
    return { ok: true, status: res.status, body: data };
  }
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, error: { status: res.status, code: 'unknown', message: text } };
  }
  return { ok: true, status: res.status, body: text };
}

export class OfflineSignal extends Error {
  constructor() {
    super('offline');
  }
}

export function expectJson<T>(result: Api): T {
  if (!result.ok) throw result.error;
  return result.body as T;
}

export function qs(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}
