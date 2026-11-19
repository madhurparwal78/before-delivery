import type { ApiErrorBody } from '../shared/types.js';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly localisedMessage: string,
    readonly fields: Record<string, string>,
    readonly retryAfter: number | null,
  ) {
    super(`${status} ${code}`);
  }

  fieldMessage(name: string): string | null {
    return this.fields[name] ?? null;
  }
}

export class NetworkFailure extends Error {}

async function parseFailure(response: Response): Promise<ApiFailure> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    body = null;
  }
  const retryAfterHeader = response.headers.get('Retry-After');
  return new ApiFailure(
    response.status,
    body?.error.code ?? 'internal',
    body?.error.message ?? '',
    body?.fields ?? {},
    retryAfterHeader === null ? null : Number.parseInt(retryAfterHeader, 10),
  );
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  extra?: { headers?: Record<string, string>; raw?: BodyInit },
): Promise<T> {
  let response: Response;
  const headers: Record<string, string> = { ...extra?.headers };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    response = await fetch(path, {
      method,
      headers,
      body: extra?.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      credentials: 'same-origin',
    });
  } catch {
    throw new NetworkFailure(path);
  }
  if (!response.ok) throw await parseFailure(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return text === '' ? (undefined as T) : (JSON.parse(text) as T);
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown): Promise<T> => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown): Promise<T> => request<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string): Promise<T> => request<T>('DELETE', path),
  upload: <T>(path: string, bytes: ArrayBuffer, filename: string): Promise<T> =>
    request<T>('POST', path, undefined, {
      headers: {
        'Content-Type': 'model/gltf-binary',
        'X-Filename': encodeURIComponent(filename),
      },
      raw: bytes,
    }),
};
