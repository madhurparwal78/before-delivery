import type { FieldErrors } from '../shared/rules.js';

export interface ApiReply<T> {
  status: number;
  ok: boolean;
  data: T;
  error?: string;
  errors?: FieldErrors;
}

/** Calls the JSON API on this origin; the session cookie carries the signed-in person. */
export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiReply<T>> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (response.status === 401 && path !== '/auth/login') {
    location.assign('/login');
  }
  return {
    status: response.status,
    ok: response.ok,
    data: parsed as T,
    error: parsed?.error,
    errors: parsed?.errors,
  };
}

export const PENDING_PROMPT = 'kinora.prompt';
