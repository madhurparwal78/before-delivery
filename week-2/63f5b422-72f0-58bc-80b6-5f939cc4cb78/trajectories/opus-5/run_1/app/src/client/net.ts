export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  fields: Record<string, string>;
}

export class RequestFailed extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  if (!response.ok) {
    const error = (parsed['error'] ?? {}) as Record<string, unknown>;
    throw new RequestFailed({
      status: response.status,
      code: String(error['code'] ?? 'error'),
      message: String(error['message'] ?? 'Something went wrong.'),
      fields: (error['fields'] ?? {}) as Record<string, string>,
    });
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown): Promise<T> => request<T>('PATCH', path, body),
  del: <T>(path: string): Promise<T> => request<T>('DELETE', path),
};

export async function postPublish<T>(
  path: string,
  idempotencyKey: string,
): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  const text = await response.text();
  const parsed = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  if (!response.ok) {
    const error = (parsed['error'] ?? {}) as Record<string, unknown>;
    throw new RequestFailed({
      status: response.status,
      code: String(error['code'] ?? 'error'),
      message: String(error['message'] ?? 'Something went wrong.'),
      fields: (error['fields'] ?? {}) as Record<string, string>,
    });
  }
  return parsed as T;
}

export async function uploadImage<T>(workspaceId: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`/api/workspaces/${workspaceId}/images`, {
    method: 'POST',
    body: form,
  });
  const text = await response.text();
  const parsed = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  if (!response.ok) {
    const error = (parsed['error'] ?? {}) as Record<string, unknown>;
    throw new RequestFailed({
      status: response.status,
      code: String(error['code'] ?? 'error'),
      message: String(error['message'] ?? 'Something went wrong.'),
      fields: (error['fields'] ?? {}) as Record<string, string>,
    });
  }
  return parsed as T;
}
