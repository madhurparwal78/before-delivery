import { announce, endPending, startPending, state, syncMainAttributes } from './state';

export type ApiError = { error: string; message: string; details?: Record<string, unknown> };

export class RequestFailed extends Error {
  readonly status: number;
  readonly body: ApiError;

  constructor(status: number, body: ApiError) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

async function send(
  method: string,
  path: string,
  body?: unknown,
  options: { control?: HTMLButtonElement | null; raw?: boolean } = {},
): Promise<unknown> {
  const write = method !== 'GET';
  if (write) startPending(options.control);
  try {
    const response = await fetch(path, {
      method,
      headers:
        body === undefined
          ? {}
          : { 'content-type': options.raw === true ? 'text/plain' : 'application/json; charset=utf-8' },
      body: body === undefined ? undefined : options.raw === true ? String(body) : JSON.stringify(body),
    });
    if (response.status === 204) return null;
    const text = await response.text();
    const parsed: unknown = text === '' ? null : JSON.parse(text);
    if (!response.ok) {
      const failure = (parsed ?? { error: 'error', message: 'Something went wrong.' }) as ApiError;
      throw new RequestFailed(response.status, failure);
    }
    const payload = parsed as { seq?: number } | null;
    if (payload !== null && typeof payload.seq === 'number') {
      state.seq = Math.max(state.seq, payload.seq);
      syncMainAttributes();
    }
    return parsed;
  } finally {
    if (write) endPending(options.control);
  }
}

export const api = {
  get: <T>(path: string): Promise<T> => send('GET', path) as Promise<T>,
  post: <T>(path: string, body?: unknown, control?: HTMLButtonElement | null): Promise<T> =>
    send('POST', path, body ?? {}, { control }) as Promise<T>,
  patch: <T>(path: string, body?: unknown, control?: HTMLButtonElement | null): Promise<T> =>
    send('PATCH', path, body ?? {}, { control }) as Promise<T>,
  put: <T>(path: string, body?: unknown, control?: HTMLButtonElement | null): Promise<T> =>
    send('PUT', path, body ?? {}, { control }) as Promise<T>,
  del: <T>(path: string, control?: HTMLButtonElement | null): Promise<T> =>
    send('DELETE', path, undefined, { control }) as Promise<T>,
  postText: <T>(path: string, body: string, control?: HTMLButtonElement | null): Promise<T> =>
    send('POST', path, body, { control, raw: true }) as Promise<T>,
};

export async function guard<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof RequestFailed) {
      announce(error.body.message);
      showPanelError(error.body.message);
      return null;
    }
    throw error;
  }
}

export function showPanelError(message: string): void {
  const strip = document.getElementById('panel-error');
  if (strip === null) return;
  strip.textContent = message;
  strip.hidden = false;
}

export function clearPanelError(): void {
  const strip = document.getElementById('panel-error');
  if (strip === null) return;
  strip.textContent = '';
  strip.hidden = true;
}
