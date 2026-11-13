export type ApiErrorShape = { error: string; message: string; fields?: Record<string, string> };

export class ApiFailure {
  status: number;
  body: ApiErrorShape;
  constructor(status: number, body: ApiErrorShape) {
    this.status = status;
    this.body = body;
  }
}

async function request<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const init: RequestInit = {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    credentials: 'same-origin',
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(path, init);
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    throw new ApiFailure(res.status, { error: 'bad_response', message: text.slice(0, 200) });
  }
  const json = await res.json();
  if (!res.ok) {
    throw new ApiFailure(res.status, json as ApiErrorShape);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> => request<T>('POST', path, body, headers),
  patch: <T>(path: string, body?: unknown): Promise<T> => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown): Promise<T> => request<T>('PUT', path, body),
  delete: <T>(path: string): Promise<T> => request<T>('DELETE', path, undefined),
};

export async function upload(path: string, fields: Record<string, string>, file: File): Promise<{ ok: boolean; status: number; body: unknown }> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', file);
  const res = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: json };
}
