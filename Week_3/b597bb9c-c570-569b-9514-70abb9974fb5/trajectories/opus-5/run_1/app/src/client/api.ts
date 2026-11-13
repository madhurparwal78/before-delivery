/** One place for API calls and the one error shape. */
export interface ApiFailure {
  error: string;
  message: string;
  errors?: Record<string, string>;
  winner?: string;
  items?: unknown[];
  projects?: string[];
  missing?: number[];
  reason?: string;
  allowance?: unknown;
  status: number;
}

export class ApiCallError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiCallError';
    this.failure = failure;
  }
}

async function parse(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 304) return null;
  const text = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const request: RequestInit = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (body !== undefined) {
    if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
      request.body = body as BodyInit;
      (request.headers as Record<string, string>)['content-type'] =
        headers['content-type'] ?? 'application/octet-stream';
    } else {
      request.body = JSON.stringify(body);
      (request.headers as Record<string, string>)['content-type'] = 'application/json';
    }
  }
  const response = await fetch(path, request);
  const payload = await parse(response);
  if (!response.ok) {
    const failure =
      payload !== null && typeof payload === 'object'
        ? { ...(payload as Record<string, unknown>), status: response.status }
        : { error: 'not_found', message: 'Nothing here. It may have been removed or you may not have access.', status: response.status };
    throw new ApiCallError(failure as unknown as ApiFailure);
  }
  return payload as T;
}

export const get = <T>(path: string): Promise<T> => call<T>('GET', path);
export const post = <T>(path: string, body?: unknown): Promise<T> => call<T>('POST', path, body ?? {});
export const put = <T>(path: string, body?: unknown): Promise<T> => call<T>('PUT', path, body ?? {});
export const remove = <T>(path: string): Promise<T> => call<T>('DELETE', path);

export function newOpId(): string {
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
