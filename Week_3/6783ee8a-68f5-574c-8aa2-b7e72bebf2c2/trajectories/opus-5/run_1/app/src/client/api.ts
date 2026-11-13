import type { FieldError } from '../shared/types.js';

export interface ApiErrorBody {
  error: string;
  message: string;
  errors?: FieldError[];
  [key: string]: unknown;
}

/** An error answer in the one API shape. */
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

  get fieldErrors(): FieldError[] {
    return this.body.errors ?? [];
  }
}

async function failure(response: Response): Promise<ApiFailure> {
  let body: ApiErrorBody = { error: 'internal', message: 'Something went wrong. Try again.' };
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    body = { error: 'internal', message: 'Something went wrong. Try again.' };
  }
  return new ApiFailure(response.status, body);
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

export async function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await failure(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

/** Downloads a file answer, keeping the name the server chose. */
export async function apiDownload(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(path);
  if (!response.ok) throw await failure(response);
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = match ? match[1] : fallbackName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
