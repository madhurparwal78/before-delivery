import type { Json } from './types';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly field: string | undefined,
    readonly body: Record<string, Json>,
  ) {
    super(message);
  }
}

async function failure(response: Response): Promise<ApiFailure> {
  const body = (await response.json().catch(() => ({}))) as Record<string, Json>;
  return new ApiFailure(response.status, typeof body.error === 'string' ? body.error : response.statusText, typeof body.field === 'string' ? body.field : undefined, body);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await failure(response);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T,>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: (path: string) => request<undefined>('DELETE', path),
};

/** POSTs a file as the raw body, the way the import route expects it. */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: file });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

/** POSTs and returns the bytes the server answered, for the export download. */
export async function downloadBlob(path: string): Promise<Blob> {
  const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!response.ok) throw await failure(response);
  return response.blob();
}

export const w = (workspaceId: string, tail = ''): string => `/api/workspaces/${workspaceId}${tail}`;
