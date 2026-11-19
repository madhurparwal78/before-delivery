import type { ApiErrorBody, DeskState, SessionInfo } from '../../shared/types.ts';

/** Same-origin calls to the published routes, and the shapes they answer. */

export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
  retryAfterSeconds?: number;
  offline?: boolean;
}

export class ApiCallError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiCallError';
    this.failure = failure;
  }
}

async function toFailure(reply: Response): Promise<ApiFailure> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await reply.json()) as ApiErrorBody;
  } catch {
    body = null;
  }
  return {
    status: reply.status,
    code: body?.error ?? 'service_unavailable',
    message: body?.message ?? '',
    ...(body?.fields ? { fields: body.fields } : {}),
    ...(body?.retry_after_seconds !== undefined
      ? { retryAfterSeconds: body.retry_after_seconds }
      : {}),
  };
}

/** A lost network is its own outcome, so the browser can queue instead. */
function offlineFailure(): ApiFailure {
  return { status: 0, code: 'offline', message: '', offline: true };
}

async function request<T>(
  method: string,
  path: string,
  init: { json?: unknown; body?: BodyInit } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  } else if (init.body !== undefined) {
    body = init.body;
  }

  let reply: Response;
  try {
    reply = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    throw new ApiCallError(offlineFailure());
  }
  if (!reply.ok) throw new ApiCallError(await toFailure(reply));
  if (reply.status === 204) return undefined as T;
  return (await reply.json()) as T;
}

export const api = {
  session: (): Promise<SessionInfo> => request('GET', '/api/session'),
  state: (ns: string): Promise<DeskState> => request('GET', `/api/desks/${ns}/state`),
  limits: (): Promise<Record<string, number>> => request('GET', '/api/limits'),
  now: (ns: string): Promise<{ now: string }> => request('GET', `/api/desks/${ns}/now`),
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, json: unknown): Promise<T> => request<T>('POST', path, { json }),
  put: <T>(path: string, json: unknown): Promise<T> => request<T>('PUT', path, { json }),
  del: <T>(path: string): Promise<T> => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData): Promise<T> =>
    request<T>('POST', path, { body: form }),
};

export const photoUrl = (ns: string, photoId: string): string =>
  `/api/desks/${ns}/photos/${photoId}`;
