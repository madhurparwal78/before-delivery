import type { SessionUser, ApiErrorShape } from '../../shared/api';

export interface ApiCallResult<T> {
  status: number;
  body: T;
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiCallResult<T>> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init?.headers,
    method: init?.method ?? 'GET',
    body: init?.body,
  });
  const text = await res.text();
  let body: unknown = null;
  if (text !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: res.status, body: body as T };
}

export async function apiGet<T>(path: string): Promise<ApiCallResult<T>> {
  return request<T>(path);
}

export async function apiJson<T>(method: string, path: string, payload?: unknown, idempotencyKey?: string): Promise<ApiCallResult<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return request<T>(path, { method, headers, body: payload === undefined ? '{}' : JSON.stringify(payload) });
}

export async function apiUpload<T>(path: string, form: FormData, idempotencyKey?: string): Promise<ApiCallResult<T>> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return request<T>(path, { method: 'POST', headers, body: form });
}

export function apiError(body: unknown): ApiErrorShape | null {
  if (body && typeof body === 'object' && 'error' in (body as Record<string, unknown>)) {
    return body as ApiErrorShape;
  }
  return null;
}

export function errorMessage(body: unknown, fallback: string): string {
  const err = apiError(body);
  return err?.error.message ?? fallback;
}

/** Idempotency keys are 1 to 100 letters, digits, hyphens or underscores. */
export function newIdempotencyKey(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let key = '';
  for (let i = 0; i < 24; i++) key += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `ui-${key}`;
}

export interface SessionResponse {
  user?: SessionUser;
}

export type { SessionUser };
