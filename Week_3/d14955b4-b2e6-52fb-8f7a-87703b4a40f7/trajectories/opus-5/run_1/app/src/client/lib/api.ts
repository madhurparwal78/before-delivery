import type { SessionBody } from '../../shared/types';

const CHANGE_TOKEN_KEY = 'hushline.change_token';
const RESUME_KEY = 'hushline.resume';
const NOTICE_KEY = 'hushline.signin_notice';

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly retryAfterSeconds: number | null;

  constructor(status: number, code: string, fields: Record<string, string>, retryAfterSeconds: number | null) {
    super(code);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function changeToken(): string {
  return window.localStorage.getItem(CHANGE_TOKEN_KEY) ?? '';
}

export function rememberSession(session: SessionBody): void {
  window.localStorage.setItem(CHANGE_TOKEN_KEY, session.change_token);
}

export function forgetSession(): void {
  window.localStorage.removeItem(CHANGE_TOKEN_KEY);
}

export interface ResumePoint {
  url: string;
  reply: string;
}

export function storeResume(point: ResumePoint): void {
  window.sessionStorage.setItem(RESUME_KEY, JSON.stringify(point));
}

export function takeResume(): ResumePoint | null {
  const raw = window.sessionStorage.getItem(RESUME_KEY);
  if (raw === null) return null;
  window.sessionStorage.removeItem(RESUME_KEY);
  try {
    return JSON.parse(raw) as ResumePoint;
  } catch {
    return null;
  }
}

export function peekResume(): ResumePoint | null {
  const raw = window.sessionStorage.getItem(RESUME_KEY);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as ResumePoint;
  } catch {
    return null;
  }
}

export function storeSignInNotice(notice: string): void {
  window.sessionStorage.setItem(NOTICE_KEY, notice);
}

export function takeSignInNotice(): string | null {
  const notice = window.sessionStorage.getItem(NOTICE_KEY);
  if (notice !== null) window.sessionStorage.removeItem(NOTICE_KEY);
  return notice;
}

type SessionEndedHandler = () => void;
let sessionEnded: SessionEndedHandler = () => {};

export function onSessionEnded(handler: SessionEndedHandler): void {
  sessionEnded = handler;
}

let refreshInFlight: Promise<boolean> | null = null;

/** One shared refresh every failed request waits on. */
export function sharedRefresh(): Promise<boolean> {
  if (refreshInFlight === null) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Change-Token': changeToken() },
          body: '{}',
        });
        if (!response.ok) return false;
        const session = (await response.json()) as SessionBody;
        rememberSession(session);
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => {
          refreshInFlight = null;
        }, 0);
      }
    })();
  }
  return refreshInFlight;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Set when the caller handles authentication itself. */
  noRefresh?: boolean;
}

async function failureFrom(response: Response): Promise<ApiFailure> {
  let code = 'internal';
  let fields: Record<string, string> = {};
  try {
    const body = (await response.json()) as { error?: { code?: string; fields?: Record<string, string> } };
    code = body.error?.code ?? code;
    fields = body.error?.fields ?? {};
  } catch {
    /* an error body that is not JSON keeps the generic code */
  }
  const retryAfter = response.headers.get('Retry-After');
  return new ApiFailure(response.status, code, fields, retryAfter === null ? null : Number(retryAfter));
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD') headers['X-Change-Token'] = changeToken();
  if (options.idempotencyKey !== undefined) headers['Idempotency-Key'] = options.idempotencyKey;
  const init: RequestInit = { method, headers };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  if (options.signal !== undefined) init.signal = options.signal;
  return fetch(path, init);
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options);
  if (response.status === 401 && !options.noRefresh) {
    const failure = await failureFrom(response);
    if (failure.code === 'unauthenticated') {
      const renewed = await sharedRefresh();
      if (!renewed) {
        sessionEnded();
        throw failure;
      }
      response = await send(path, options);
    } else {
      throw failure;
    }
  }
  if (!response.ok) throw await failureFrom(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function login(email: string, password: string): Promise<SessionBody> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw await failureFrom(response);
  const session = (await response.json()) as SessionBody;
  rememberSession(session);
  return session;
}

export async function loadSession(): Promise<SessionBody | null> {
  try {
    return await api<SessionBody>('/api/auth/session');
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await api('/api/auth/logout', { method: 'POST', body: {}, noRefresh: true });
  } catch {
    /* the browser leaves for /signin either way */
  }
  forgetSession();
}
