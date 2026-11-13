// One shared API client: the single place that refreshes an expired session.

export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
  retryAfter?: number | null;
  replay?: boolean;
}

let changeToken = '';
let session: unknown = null;
let refreshInFlight: Promise<boolean> | null = null;
const sessionEnded = new Set<() => void>();

export function setChangeToken(token: string): void {
  changeToken = token;
}

export function onChangeSession(listener: () => void): void {
  sessionEnded.add(listener);
}

function failureFrom(response: Response, body: unknown): ApiFailure {
  const parsed = body as { error?: { code?: string; message?: string; fields?: Record<string, string>; retry_after?: string } };
  return {
    status: response.status,
    code: parsed?.error?.code ?? 'unknown',
    message: parsed?.error?.message ?? '',
    fields: parsed?.error?.fields,
    retryAfter: response.headers.get('retry-after') ? Number(response.headers.get('retry-after')) : null,
    replay: response.headers.get('idempotent-replay') === 'true',
  };
}

async function rawRequest(method: string, path: string, body: unknown | null, headers: Record<string, string> = {}): Promise<{ response: Response; json: unknown }> {
  const init: RequestInit = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (body !== null) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  if (changeToken !== '') {
    (init.headers as Record<string, string>)['x-change-token'] = changeToken;
  }
  const response = await fetch(path, init);
  const text = await response.text();
  let json: unknown = null;
  if (text !== '') {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { response, json };
}

export async function refreshSession(): Promise<boolean> {
  const response = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin', body: '' });
  if (!response.ok) return false;
  const body = await response.json();
  changeToken = body.change_token;
  session = body;
  return true;
}

export interface ApiResult<T> {
  ok: boolean;
  body?: T;
  failure?: ApiFailure;
}

export async function api<T>(method: string, path: string, body?: unknown | null, headers?: Record<string, string>): Promise<ApiResult<T>> {
  const attempt = await rawRequest(method, path, body ?? null, headers ?? {});
  if (attempt.response.status !== 401 || path === '/api/auth/refresh') {
    if (attempt.response.ok) {
      return { ok: true, body: attempt.json as T };
    }
    return { ok: false, failure: failureFrom(attempt.response, attempt.json) };
  }
  if (!refreshInFlight) {
    refreshInFlight = refreshSession().then((renewed) => {
      refreshInFlight = null;
      return renewed;
    });
  }
  const renewed = await refreshInFlight;
  if (!renewed) {
    for (const listener of sessionEnded) listener();
    return { ok: false, failure: failureFrom(attempt.response, attempt.json) };
  }
  const retry = await rawRequest(method, path, body ?? null, headers ?? {});
  if (retry.response.ok) return { ok: true, body: retry.json as T };
  return { ok: false, failure: failureFrom(retry.response, retry.json) };
}

export async function apiStream(path: string, onEvent: (event: string, data: unknown) => void, onOpen?: () => Promise<void>, onClose?: () => void): Promise<() => void> {
  const source = new EventSource(path);
  let renewing = false;
  source.onmessage = () => {};
  source.onerror = async () => {
    if (renewing) return;
    renewing = true;
    const response = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin', body: '' });
    if (!response.ok) {
      source.close();
      for (const listener of sessionEnded) listener();
      return;
    }
    const body = await response.json();
    changeToken = body.change_token;
    renewing = false;
  };
  const known = ['message', 'thread_status', 'attachment', 'rules_changed'];
  for (const name of known) {
    source.addEventListener(name, (event) => {
      const data = (event as MessageEvent).data;
      onEvent(name, data ? JSON.parse(data) : {});
    });
  }
  return () => {
    source.close();
    if (onClose) onClose();
  };
}

export function getChangeToken(): string {
  return changeToken;
}
