import type { ApiErrorBody } from '../../shared/plan.js';

export interface ApiAnswer<T> {
  status: number;
  data?: T;
  error?: ApiErrorBody['error'];
  retryAfterMinutes?: number;
  /** True when the request never reached the server. */
  offline?: boolean;
}

export interface ApiRequest {
  body?: unknown;
  headers?: Record<string, string>;
}

export async function call<T>(method: string, path: string, request: ApiRequest = {}): Promise<ApiAnswer<T>> {
  const headers: Record<string, string> = { ...request.headers };
  if (request.body !== undefined) headers['content-type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
  } catch {
    return { status: 0, offline: true };
  }
  const retryAfter = response.headers.get('retry-after');
  const minutes = retryAfter === null ? undefined : Math.ceil(Number(retryAfter) / 60);
  if (response.status === 204) return { status: 204 };
  let payload: unknown;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    return { status: response.status, retryAfterMinutes: minutes };
  }
  if (response.ok) return { status: response.status, data: payload as T, retryAfterMinutes: minutes };
  const body = payload as ApiErrorBody;
  return { status: response.status, error: body?.error, retryAfterMinutes: minutes };
}
