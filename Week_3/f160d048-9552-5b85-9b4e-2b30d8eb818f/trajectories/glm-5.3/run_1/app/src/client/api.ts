// API client: one fetch wrapper with the published error shape.
export interface ApiErrorShape {
  error: string;
  message: string;
  fields?: Record<string, string>;
  field?: string;
}

export class ApiFailure extends Error {
  status: number;
  body: ApiErrorShape;

  constructor(status: number, body: ApiErrorShape) {
    super(body.message);
    this.status = status;
    this.body = body;
  }

  fieldError(name: string): string | null {
    return this.body.fields?.[name] ?? null;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData)
        ? { 'content-type': 'application/json; charset=utf-8' }
        : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const data = text.length > 0 ? (JSON.parse(text) as unknown) : undefined;
  if (!response.ok) {
    throw new ApiFailure(response.status, data as ApiErrorShape);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  form: <T>(path: string, body: FormData, headers?: Record<string, string>) =>
    request<T>(path, { method: 'POST', body, headers }),
  raw: <T>(path: string, init: RequestInit) => request<T>(path, init),
};

export function apiErrorMessage(err: unknown): string {
  if (err instanceof ApiFailure) return err.body.message;
  return 'Something went wrong.';
}
