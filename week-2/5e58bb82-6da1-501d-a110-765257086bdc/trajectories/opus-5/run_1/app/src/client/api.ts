import type { ApiErrorBody } from '../shared/types.js';

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.code = body.error;
    this.body = body;
  }
}

/** A request that reached no HTTP response at all. */
export class NoResponse extends Error {
  constructor() {
    super('no response');
  }
}

/**
 * Responses that resolve after a sign-out are discarded. The generation rises on
 * every sign-out, so nothing of the previous account can be painted.
 */
let generation = 0;

export function newGeneration(): number {
  generation += 1;
  return generation;
}

export function currentGeneration(): number {
  return generation;
}

export function isCurrent(at: number): boolean {
  return at === generation;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  raw?: BodyInit;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onProgress?: (sent: number, total: number) => void;
}

async function parseError(response: Response): Promise<never> {
  let body: ApiErrorBody = { error: 'internal', message: 'Something went wrong on the server.' };
  try {
    const parsed = (await response.json()) as ApiErrorBody;
    if (parsed && typeof parsed.error === 'string') body = parsed;
  } catch {
    // An error body that is not JSON keeps the published fallback.
  }
  throw new ApiFailure(response.status, body);
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined;
  if (options.raw !== undefined) {
    body = options.raw;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body,
      credentials: 'same-origin',
      signal: options.signal ?? null,
    });
  } catch {
    throw new NoResponse();
  }
  if (!response.ok) await parseError(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text.length === 0 ? undefined : JSON.parse(text)) as T;
}

export async function requestWithHeaders<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; headers: Headers }> {
  let response: Response;
  try {
    response = await fetch(path, { method: options.method ?? 'GET', credentials: 'same-origin' });
  } catch {
    throw new NoResponse();
  }
  if (!response.ok) await parseError(response);
  const text = await response.text();
  return {
    data: (text.length === 0 ? undefined : JSON.parse(text)) as T,
    headers: response.headers,
  };
}

/**
 * Sends a body with progress in whole percent. XHR is used because it is the only
 * transport that reports how much of the body has been sent.
 */
export function uploadWithProgress(
  path: string,
  method: string,
  body: Blob | ArrayBuffer,
  headers: Record<string, string>,
  onProgress: (percent: number) => void,
): Promise<{ status: number; data: unknown }> {
  return new Promise((settle, fail) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, path, true);
    xhr.withCredentials = true;
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      // Never show above 99 before the server answers.
      onProgress(Math.min(99, Math.floor((event.loaded / event.total) * 100)));
    });
    xhr.addEventListener('load', () => {
      let data: unknown;
      try {
        data = xhr.responseText.length > 0 ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        data = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        settle({ status: xhr.status, data });
        return;
      }
      const parsed = (data ?? {}) as ApiErrorBody;
      fail(
        new ApiFailure(xhr.status, {
          ...parsed,
          error: typeof parsed.error === 'string' ? parsed.error : 'internal',
          message:
            typeof parsed.message === 'string'
              ? parsed.message
              : 'Something went wrong on the server.',
        }),
      );
    });
    xhr.addEventListener('error', () => fail(new NoResponse()));
    xhr.addEventListener('abort', () => fail(new NoResponse()));
    xhr.send(body instanceof Blob ? body : new Blob([body]));
  });
}
