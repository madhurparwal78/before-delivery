import type { ApiErrorBody } from '../shared/types.js';

export interface ApiFailure {
  ok: false;
  status: number;
  error: ApiErrorBody;
}

export interface ApiSuccess<T> {
  ok: true;
  status: number;
  data: T;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export function idempotencyKey(): string {
  return `hs-${crypto.randomUUID().replace(/-/g, '')}`;
}

interface RequestOptions {
  body?: unknown;
  form?: FormData;
  key?: string;
}

async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.form !== undefined) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.key !== undefined) headers['idempotency-key'] = options.key;
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    return {
      ok: false,
      status: 0,
      error: { error: 'network', message: 'The server could not be reached.' },
    };
  }
  if (response.status === 204) return { ok: true, status: 204, data: undefined as T };
  const text = await response.text();
  const parsed: unknown = text === '' ? {} : JSON.parse(text);
  if (!response.ok) {
    return { ok: false, status: response.status, error: parsed as ApiErrorBody };
  }
  return { ok: true, status: response.status, data: parsed as T };
}

export const api = {
  get: <T>(path: string): Promise<ApiResult<T>> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, key?: string): Promise<ApiResult<T>> =>
    request<T>('POST', path, { body: body ?? {}, key }),
  postForm: <T>(path: string, form: FormData): Promise<ApiResult<T>> =>
    request<T>('POST', path, { form }),
  delete: <T>(path: string): Promise<ApiResult<T>> => request<T>('DELETE', path),
};

export function firstFieldMessage(error: ApiErrorBody): string {
  const fields = error.fields;
  if (fields === undefined) return error.message;
  const first = Object.values(fields)[0];
  return first ?? error.message;
}
