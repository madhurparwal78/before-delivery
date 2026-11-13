import type { ErrorBody } from '../shared/errors.js';

export class RequestFailed extends Error {
  readonly status: number;
  readonly body: ErrorBody;

  constructor(status: number, body: ErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(method: string, path: string, body?: unknown, raw?: BodyInit): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: raw ? {} : body === undefined ? {} : { 'content-type': 'application/json' },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    credentials: 'same-origin',
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) throw new RequestFailed(response.status, parsed as ErrorBody);
  return parsed as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown): Promise<T> => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown): Promise<T> => request<T>('PATCH', path, body),
  remove: <T>(path: string): Promise<T> => request<T>('DELETE', path),
  upload: <T>(path: string, bytes: BodyInit): Promise<T> => request<T>('POST', path, undefined, bytes),
};

export interface ClientSettings {
  toastMs: number;
  domMarginPx: number;
  domCeiling: number;
}

export function settings(): ClientSettings {
  const node = document.getElementById('plot-settings');
  if (!node || !node.textContent) return { toastMs: 5000, domMarginPx: 200, domCeiling: 500 };
  return JSON.parse(node.textContent) as ClientSettings;
}
