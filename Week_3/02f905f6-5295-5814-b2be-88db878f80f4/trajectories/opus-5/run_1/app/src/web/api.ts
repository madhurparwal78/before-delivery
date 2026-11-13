import type { ApiErrorBody, PhotoReceipt } from '../shared/types';

export class ApiFailure extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }

  get fields(): Record<string, string> {
    return this.body.fields ?? {};
  }
}

const OFFLINE: ApiErrorBody = {
  error: 'unreachable',
  message: 'The studio server is unreachable.',
};

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers:
        body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiFailure(0, OFFLINE);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiFailure(response.status, (parsed as ApiErrorBody | null) ?? OFFLINE);
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> =>
    request<T>('POST', path, body ?? {}, headers),
  patch: <T>(path: string, body: unknown): Promise<T> => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown): Promise<T> => request<T>('PUT', path, body),
  del: <T>(path: string): Promise<T> => request<T>('DELETE', path),
};

/** Uploads one photo and resolves only once the server has stored it. */
export async function uploadPhoto(file: File): Promise<PhotoReceipt> {
  const form = new FormData();
  form.append('photo', file);
  let response: Response;
  try {
    response = await fetch('/api/photos', {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiFailure(0, OFFLINE);
  }
  const text = await response.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiFailure(response.status, (parsed as ApiErrorBody | null) ?? OFFLINE);
  }
  return parsed as PhotoReceipt;
}

export function newIdempotencyKey(): string {
  return `shelfmark-${crypto.randomUUID()}`;
}
