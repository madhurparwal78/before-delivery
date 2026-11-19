import type { Cart, Entry, Offer, Order, Performance, Seat } from '../shared/api-types';

export type ApiResult<T> =
  | { ok: true; value: T; status: number }
  | { ok: false; status: number; error: string; fields?: Record<string, string>; body: Record<string, unknown> | null };

export async function api<T>(path: string, init: { method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined || init.method === 'POST' || init.method === 'DELETE') {
    headers['Content-Type'] = 'application/json';
  }
  if (init.idempotencyKey) {
    headers['Idempotency-Key'] = init.idempotencyKey;
  }
  const response = await fetch(path, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : init.method === 'POST' || init.method === 'DELETE' ? JSON.stringify({}) : undefined,
    credentials: 'same-origin',
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (response.ok) {
    return { ok: true, value: parsed as T, status: response.status };
  }
  let error = '';
  let fields: Record<string, string> | undefined;
  let body: Record<string, unknown> | null = null;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    body = record;
    error = typeof record.error === 'string' ? record.error : '';
    if (record.fields && typeof record.fields === 'object') {
      fields = record.fields as Record<string, string>;
    }
  }
  return { ok: false, status: response.status, error, fields, body };
}

export type { Cart, Entry, Offer, Order, Performance, Seat };
