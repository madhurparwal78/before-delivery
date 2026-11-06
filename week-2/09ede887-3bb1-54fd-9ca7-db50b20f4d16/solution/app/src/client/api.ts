import type { ErrorDetail } from '../shared/api';

// Every call the page makes goes through here: /api/v2 only, JSON in and out.

export type ApiResult<T> =
  | { ok: true; status: number; data: T; next: string | null }
  | { ok: false; status: number; error: ErrorDetail };

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  token?: string | null;
  body?: unknown;
  headers?: Record<string, string>;
  retryOnce?: boolean;
}

const NO_ANSWER: ErrorDetail = { code: 'unavailable', message: 'No answer from the server.' };

function isErrorDetail(value: unknown): value is ErrorDetail {
  return typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string';
}

function nextLink(header: string | null): string | null {
  if (!header) return null;
  const open = header.indexOf('<');
  const close = header.indexOf('>', open + 1);
  if (open !== 0 || close < 0 || !header.slice(close).includes('rel="next"')) return null;
  return header.slice(open + 1, close);
}

async function send(path: string, options: RequestOptions): Promise<Response | null> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const init: RequestInit = { method: options.method ?? 'GET', headers };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  const attempts = options.retryOnce ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(path, init);
    } catch {
      // No answer at all (dropped connection): the one retry reuses the same headers and key.
    }
  }
  return null;
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorOf(payload: unknown): ErrorDetail {
  const detail = typeof payload === 'object' && payload !== null && 'error' in payload ? payload.error : null;
  return isErrorDetail(detail) ? detail : NO_ANSWER;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const response = await send(path, options);
  if (!response) return { ok: false, status: 0, error: NO_ANSWER };
  const payload = await json(response);
  if (response.ok) {
    return { ok: true, status: response.status, data: payload as T, next: nextLink(response.headers.get('Link')) };
  }
  return { ok: false, status: response.status, error: errorOf(payload) };
}

export type DownloadResult = { ok: true; blob: Blob; filename: string } | { ok: false; error: ErrorDetail };

export async function download(path: string, token: string): Promise<DownloadResult> {
  const response = await send(path, { token, headers: { Accept: 'text/csv' } });
  if (!response) return { ok: false, error: NO_ANSWER };
  if (!response.ok) return { ok: false, error: errorOf(await json(response)) };
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const start = disposition.indexOf('filename="');
  const filename = start >= 0 ? disposition.slice(start + 10, disposition.indexOf('"', start + 10)) : 'roster.csv';
  return { ok: true, blob: await response.blob(), filename };
}

const API_ROOT = '/api/v2';

// Paths in the API tables are relative to the version root; the page joins them here.
export function apiPath(path: string): string {
  return `${API_ROOT}${path}`;
}

export function sessionPath(id: string, action?: string): string {
  const base = apiPath(`/sessions/${encodeURIComponent(id)}`);
  return action ? `${base}/${action}` : base;
}
