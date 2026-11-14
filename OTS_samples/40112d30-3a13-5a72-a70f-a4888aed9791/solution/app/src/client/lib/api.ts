import type { ApiError, ErrorItem } from '../../shared/types.ts';

// Every API reply is JSON in one shape; a refusal rejects with the server's own code and copy.

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly items: ErrorItem[]) {
    super(message);
  }
}

export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const reply = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (reply.status === 204) return undefined as T;
  const text = await reply.text();
  const data: unknown = text ? JSON.parse(text) : null;
  if (!reply.ok) {
    const error = (data as ApiError | null)?.error;
    throw new ApiFailure(reply.status, error?.code ?? 'ERROR', error?.message ?? 'Something went wrong.', error?.items ?? []);
  }
  return data as T;
}

export async function upload<T>(path: string, file: File): Promise<T> {
  const reply = await fetch(path, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  });
  const data: unknown = await reply.json();
  if (!reply.ok) {
    const error = (data as ApiError).error;
    throw new ApiFailure(reply.status, error.code, error.message, error.items ?? []);
  }
  return data as T;
}
