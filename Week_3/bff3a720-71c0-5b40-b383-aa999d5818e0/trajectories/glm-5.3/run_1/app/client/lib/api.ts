import type { ApiErrorBody } from './types.js';

export class ApiFail extends Error {
  constructor(readonly status: number, readonly body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiFail';
  }
  get code(): string { return this.body.error; }
  get fields(): Record<string, string> { return this.body.fields ?? {}; }
}

export async function api<T>(method: string, path: string, body?: unknown, opts: { idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try { data = text.length > 0 ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new ApiFail(res.status, (data ?? { error: 'unknown', message: 'Something went wrong.' }) as ApiErrorBody);
  return data as T;
}

export async function upload(path: string, file: File | Blob): Promise<unknown> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(path, { method: 'POST', body: fd, credentials: 'same-origin' });
  const text = await res.text();
  let data: unknown = null;
  try { data = text.length > 0 ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new ApiFail(res.status, (data ?? { error: 'unknown', message: 'Something went wrong.' }) as ApiErrorBody);
  return data;
}
