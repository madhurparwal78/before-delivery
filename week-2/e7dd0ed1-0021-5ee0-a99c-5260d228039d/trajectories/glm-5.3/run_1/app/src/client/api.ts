// Client API helper: fetch wrapper with the session cookie and error shaping.
export interface ApiError { status: number; error: string; message: string; errors?: Record<string, string>; retry_after_seconds?: number; [k: string]: unknown }

export async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T; headers: Headers }> {
  const res = await fetch(path, {
    method,
    headers: {
      'X-Requested-With': 'farshore',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {} as T;
  try { data = await res.json() as T; } catch { /* empty body */ }
  return { status: res.status, data, headers: res.headers };
}

export async function uploadObject(
  ws: string, bucket: string, key: string, bytes: ArrayBuffer, opts: {
    contentType: string; idempotencyKey?: string; ifMatch?: string; ifNoneMatch?: string;
    metadata?: Record<string, string>; tags?: Record<string, string>;
  },
): Promise<{ status: number; data: Record<string, unknown>; replayed: boolean }> {
  const headers: Record<string, string> = {
    'Content-Type': opts.contentType,
    'X-Upload-Size': String(bytes.byteLength),
    'X-Requested-With': 'farshore',
  };
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  if (opts.ifMatch) headers['If-Match'] = opts.ifMatch;
  if (opts.ifNoneMatch) headers['If-None-Match'] = opts.ifNoneMatch;
  for (const [k, v] of Object.entries(opts.metadata ?? {})) headers[`x-amz-meta-${k}`] = v;
  if (opts.tags && Object.keys(opts.tags).length > 0) {
    headers['x-amz-tagging'] = new URLSearchParams(opts.tags).toString();
  }
  const res = await fetch(`/api/w/${ws}/buckets/${bucket}/object?key=${encodeURIComponent(key)}`, {
    method: 'PUT', headers, body: bytes, credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data: data as Record<string, unknown>, replayed: res.headers.get('Idempotent-Replayed') === 'true' };
}

export function qs(params: Record<string, string | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s.length > 0 ? '?' + s : '';
}
