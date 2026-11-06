import type { ApiErrorBody } from '../shared/types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly detail: ApiErrorBody['error'];

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.status = status;
    this.code = body.error.code;
    this.fields = body.error.fields ?? {};
    this.detail = body.error;
  }
}

type Listener = (inFlight: number) => void;

let inFlight = 0;
const listeners = new Set<Listener>();
let onUnauthenticated: (() => void) | null = null;

export function watchRequests(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

function notify(): void {
  for (const listener of listeners) listener(inFlight);
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  inFlight += 1;
  notify();
  try {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    let body: BodyInit | undefined;
    if (options.formData) {
      body = options.formData;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      body = JSON.stringify(options.body);
    }
    return await fetch(path, { method: options.method ?? 'GET', headers, body, credentials: 'same-origin' });
  } finally {
    inFlight -= 1;
    notify();
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text === '' ? {} : (JSON.parse(text) as unknown);
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/session') onUnauthenticated?.();
    throw new ApiError(response.status, parsed as ApiErrorBody);
  }
  return parsed as T;
}

export async function requestBlob(path: string): Promise<{ blob: Blob; filename: string }> {
  const response = await send(path, {});
  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, JSON.parse(text === '' ? '{}' : text) as ApiErrorBody);
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/u.exec(disposition)?.[1] ?? 'download';
  return { blob: await response.blob(), filename };
}
