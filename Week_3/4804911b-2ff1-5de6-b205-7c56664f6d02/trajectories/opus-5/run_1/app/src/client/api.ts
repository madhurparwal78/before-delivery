export interface ApiResult<T> {
  status: number;
  body: T;
  retryAfter: number | null;
}

export interface ApiFailure {
  error: string;
  message: string;
  fields?: Record<string, string>;
  rows?: unknown[];
  batches?: string[];
  openRows?: number;
  retryAfter?: number;
}

export class EndedSession extends Error {}
export class Forbidden extends Error {}
export class LostRequest extends Error {}

type Listener = () => void;

const endedListeners: Listener[] = [];
const forbiddenListeners: Listener[] = [];

export function onEndedSession(listener: Listener): void {
  endedListeners.push(listener);
}

export function onForbidden(listener: Listener): void {
  forbiddenListeners.push(listener);
}

export interface RequestOptions {
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
  silentAuth?: boolean;
}

export async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: options.formData === undefined && options.body !== undefined
        ? { 'content-type': 'application/json' }
        : undefined,
      body:
        options.formData !== undefined
          ? options.formData
          : options.body === undefined
            ? undefined
            : JSON.stringify(options.body),
      signal: options.signal,
      credentials: 'same-origin',
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new LostRequest('the request did not reach the server');
  }
  const retryAfterHeader = response.headers.get('retry-after');
  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (response.status === 401 && options.silentAuth !== true) {
    for (const listener of endedListeners) listener();
    throw new EndedSession('session ended');
  }
  if (response.status === 403 && (body as ApiFailure | null)?.error === 'forbidden') {
    for (const listener of forbiddenListeners) listener();
    throw new Forbidden('forbidden');
  }
  return {
    status: response.status,
    body: body as T,
    retryAfter: retryAfterHeader === null ? null : Number(retryAfterHeader),
  };
}

export function failureOf(result: ApiResult<unknown>): ApiFailure {
  const body = result.body as ApiFailure | null;
  if (body !== null && typeof body === 'object' && typeof body.message === 'string') return body;
  return { error: 'unknown', message: 'That did not work. Try again.' };
}

export function ok(result: ApiResult<unknown>): boolean {
  return result.status >= 200 && result.status < 300;
}
