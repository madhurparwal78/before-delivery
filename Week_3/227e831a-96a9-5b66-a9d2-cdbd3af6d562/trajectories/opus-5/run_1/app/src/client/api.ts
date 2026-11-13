import type { ApiError } from '../shared/types.js';

export interface ApiOk<T> {
  ok: true;
  status: number;
  data: T;
}

export interface ApiFail {
  ok: false;
  status: number;
  code: string;
  message: string;
  fields: Record<string, string>;
  offline: boolean;
}

export type ApiResult<T> = ApiOk<T> | ApiFail;

const offlineFailure: ApiFail = {
  ok: false,
  status: 0,
  code: 'offline',
  message: "Couldn't reach Skinout.",
  fields: {},
  offline: true,
};

export async function api<T>(
  method: string,
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    return { ...offlineFailure };
  }
  if (response.status === 204) return { ok: true, status: 204, data: undefined as T };
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  const error = (parsed as ApiError | null)?.error;
  return {
    ok: false,
    status: response.status,
    code: error?.code ?? 'internal_error',
    message: error?.message ?? 'Something went wrong. Try again.',
    fields: error?.fields ?? {},
    offline: false,
  };
}

export async function upload<T>(
  path: string,
  field: string,
  file: File,
): Promise<ApiResult<T>> {
  const form = new FormData();
  form.append(field, file, file.name);
  let response: Response;
  try {
    response = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
  } catch {
    return { ...offlineFailure };
  }
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  const error = (parsed as ApiError | null)?.error;
  return {
    ok: false,
    status: response.status,
    code: error?.code ?? 'internal_error',
    message: error?.message ?? 'Something went wrong. Try again.',
    fields: error?.fields ?? {},
    offline: false,
  };
}
