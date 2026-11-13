import { useSyncExternalStore } from 'react';
import type { ApiErrorBody, SessionBody } from '../shared/types.js';
import { announce } from './announce.js';
import { navigate } from './router.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly headers: Headers = new Headers(),
  ) {
    super(message);
  }
}

const SESSION_KEY = 'hl:session';
export const RETURN_KEY = 'hl:return';

function stored(): SessionBody | null {
  try {
    return JSON.parse(window.sessionStorage.getItem(SESSION_KEY) ?? 'null') as SessionBody | null;
  } catch {
    return null;
  }
}

let session: SessionBody | null = stored();
let epoch = 0;
let renewing: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function setSession(next: SessionBody | null): void {
  session = next;
  if (next) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
  else window.sessionStorage.removeItem(SESSION_KEY);
  for (const listener of listeners) listener();
}

export function useSession(): SessionBody | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => session,
  );
}

function sessionEnded(): void {
  const here = `${window.location.pathname}${window.location.search}`;
  if (/^\/(inbox|team)/.test(here)) window.sessionStorage.setItem(RETURN_KEY, here);
  setSession(null);
  announce('Sign-in announcements', 'Your session ended. Sign in again.');
  navigate('/signin', { replace: true });
}

async function errorOf(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  return new ApiError(response.status, body?.error.code ?? 'unknown', body?.error.message ?? 'Request failed.', body?.error.fields, response.headers);
}

async function renew(): Promise<void> {
  renewing ??= (async () => {
    const response = await fetch('/api/auth/refresh', { method: 'POST', headers: session ? { 'X-Change-Token': session.change_token } : {} });
    if (!response.ok) {
      sessionEnded();
      throw await errorOf(response);
    }
    epoch += 1;
    setSession((await response.json()) as SessionBody);
  })().finally(() => {
    renewing = null;
  });
  return renewing;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  key?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  staff?: boolean;
}

export async function request(path: string, options: RequestOptions = {}): Promise<Response> {
  const method = options.method ?? 'GET';
  for (let attempt = 0; ; attempt += 1) {
    const sentIn = epoch;
    const headers: Record<string, string> = { ...options.headers };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.key) headers['Idempotency-Key'] = options.key;
    if (method !== 'GET' && session) headers['X-Change-Token'] = session.change_token;
    const response = await fetch(path, {
      method,
      headers,
      signal: options.signal,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (response.status !== 401 || options.staff === false || attempt > 0) return response;
    const error = await errorOf(response.clone());
    if (error.code !== 'unauthenticated') return response;
    if (epoch === sentIn) await renew();
  }
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(path, options);
  if (!response.ok) throw await errorOf(response);
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export async function loadSession(): Promise<SessionBody | null> {
  try {
    const body = await api<SessionBody>('/api/auth/session');
    setSession(body);
    return body;
  } catch {
    setSession(null);
    return null;
  }
}
