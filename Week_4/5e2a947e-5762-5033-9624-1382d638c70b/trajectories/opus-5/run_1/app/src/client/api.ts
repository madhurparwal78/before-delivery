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

async function send<T>(
  method: string,
  path: string,
  body?: unknown,
  raw?: BodyInit,
): Promise<T> {
  const init: RequestInit = { method, headers: {}, credentials: 'same-origin' };
  if (raw !== undefined) {
    init.body = raw;
    init.headers = { 'content-type': 'application/octet-stream' };
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text === '' ? {} : (JSON.parse(text) as unknown);
  if (!response.ok) {
    throw new RequestFailed(response.status, parsed as ErrorBody);
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => send<T>('GET', path),
  post: <T>(path: string, body?: unknown) => send<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => send<T>('PUT', path, body),
  del: <T>(path: string) => send<T>('DELETE', path),
  upload: <T>(path: string, bytes: ArrayBuffer | Blob) => send<T>('POST', path, undefined, bytes),
};
