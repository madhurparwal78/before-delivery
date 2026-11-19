import type { ApiErrorBody } from '../../shared/types.js';

export class ApiFailure extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }

  get code(): string {
    return this.body.error;
  }

  get fieldErrors(): Record<string, string> {
    return this.body.errors ?? {};
  }
}

const offline: ApiErrorBody = { error: 'offline', message: 'The server could not be reached.' };

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiFailure(0, offline);
  }
}

async function unwrap<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  const parsed: unknown = text === '' ? {} : JSON.parse(text);
  if (!response.ok) {
    throw new ApiFailure(response.status, parsed as ApiErrorBody);
  }
  return parsed as T;
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return unwrap<T>(await send(path, { method: 'GET', signal }));
}

export async function apiSend<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json', ...headers };
    init.body = JSON.stringify(body);
  }
  return unwrap<T>(await send(path, init));
}

export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  return unwrap<T>(await send(path, { method: 'POST', body: form }));
}
