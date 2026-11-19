import type { ApiErrorBody, ErrorCode } from '../shared/api';

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields: Record<string, string>;
  readonly head: number | null;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiFailure';
    this.status = status;
    this.code = body.error;
    this.fields = body.fields ?? {};
    this.head = body.head ?? null;
  }
}

const OFFLINE: ApiErrorBody = {
  error: 'storage_unavailable',
  message: 'The app could not be reached.',
};

const send = async (
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> => {
  const init: RequestInit = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json; charset=utf-8';
  }
  try {
    return await fetch(path, init);
  } catch {
    throw new ApiFailure(503, OFFLINE);
  }
};

const parse = async <T>(response: Response): Promise<T> => {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload = text.length > 0 ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) throw new ApiFailure(response.status, payload as ApiErrorBody);
  return payload as T;
};

export const api = {
  get: async <T>(path: string): Promise<T> => parse<T>(await send('GET', path)),
  post: async <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> =>
    parse<T>(await send('POST', path, body ?? {}, headers)),
  patch: async <T>(path: string, body: unknown): Promise<T> =>
    parse<T>(await send('PATCH', path, body)),
  put: async <T>(path: string): Promise<T> => parse<T>(await send('PUT', path)),
  delete: async <T>(path: string): Promise<T> => parse<T>(await send('DELETE', path)),
  raw: (method: string, path: string): Promise<Response> => send(method, path),
};
