// The one place the client talks to the API: JSON in and out, errors in the published shape, link auth.
import type { ApiErrorBody } from '../shared/types.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error ?? 'validation');
    this.status = status;
    this.body = body;
  }

  get code(): string | undefined {
    return this.body.error;
  }

  /** Field errors of a 422, keyed by field. */
  get fields(): Record<string, string> {
    return this.body.errors ?? {};
  }
}

let linkToken: string | null = null;

/** Share-link holders authenticate with `Authorization: Link <token>` instead of the session cookie. */
export function useLinkToken(token: string | null): void {
  linkToken = token;
}

export function authHeaders(): Record<string, string> {
  return linkToken ? { Authorization: `Link ${linkToken}` } : {};
}

async function parse(response: Response): Promise<unknown> {
  // A 204's empty body is read too: Chromium logs an unread response body as an aborted request.
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function request<T>(method: string, path: string, body?: unknown, init?: { signal?: AbortSignal }): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    signal: init?.signal,
  });
  const payload = await parse(response);
  if (!response.ok) throw new ApiError(response.status, (payload ?? {}) as ApiErrorBody);
  return payload as T;
}

export const get = <T>(path: string, init?: { signal?: AbortSignal }) => request<T>('GET', path, undefined, init);
export const post = <T>(path: string, body: unknown = {}) => request<T>('POST', path, body);
export const del = <T = null>(path: string) => request<T>('DELETE', path);

export async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(path, { method: 'POST', body: form, headers: authHeaders(), credentials: 'same-origin' });
  const payload = await parse(response);
  if (!response.ok) throw new ApiError(response.status, (payload ?? {}) as ApiErrorBody);
  return payload as T;
}

/** Real-time pause: AbortSignal.timeout runs on the browser's own clock, so a faked page clock cannot hold it. */
const pause = (ms: number): Promise<void> => new Promise((resolve) => AbortSignal.timeout(ms).addEventListener('abort', () => resolve(), { once: true }));

const SETTLE_POLL_MS = 100;
const SETTLE_QUIET_POLLS = 8;
const SETTLE_MAX_POLLS = 30;

/**
 * Lets the page finish loading before a stream is held open: an open stream is a request that never ends, so
 * a load that opens it at once is never "network idle" for anything that waits for the page to settle.
 * Resolves once no new resource has finished for a while, or after a cap.
 */
async function settled(signal: AbortSignal): Promise<void> {
  let seen = -1;
  let quiet = 0;
  for (let polls = 0; polls < SETTLE_MAX_POLLS && quiet < SETTLE_QUIET_POLLS && !signal.aborted; polls += 1) {
    await pause(SETTLE_POLL_MS);
    const count = performance.getEntriesByType('resource').length;
    quiet = count === seen ? quiet + 1 : 0;
    seen = count;
  }
}

/**
 * Server-sent events over fetch (EventSource cannot send the link header). Calls `onEvent` for each event and
 * reconnects after `retryMs` until the returned function is called. `onOpen` runs on every (re)connect; the first
 * one comes after the page has settled, so callers fetch again whatever they missed meanwhile.
 */
export function stream(
  path: string,
  onEvent: (event: string, data: unknown) => void,
  hooks: { onOpen?: () => void; onClose?: () => void } = {},
  retryMs = 1000,
): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const connect = async (): Promise<void> => {
    try {
      const response = await fetch(path, { headers: { Accept: 'text/event-stream', ...authHeaders() }, credentials: 'same-origin', signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(String(response.status));
      hooks.onOpen?.();
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let cut = buffer.indexOf('\n\n');
        while (cut >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          let name = 'message';
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) name = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (data) onEvent(name, JSON.parse(data));
          cut = buffer.indexOf('\n\n');
        }
      }
    } catch {
      if (controller.signal.aborted) return;
    }
    if (controller.signal.aborted) return;
    hooks.onClose?.();
    timer = setTimeout(() => void connect(), retryMs);
  };

  void settled(controller.signal).then(() => (controller.signal.aborted ? undefined : connect()));
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
