import type { ApiErrorBody } from '../../shared/types';

export type ApiOutcome<T> =
  | { kind: 'ok'; status: number; body: T; etag: string | null }
  | { kind: 'error'; status: number; body: ApiErrorBody }
  /** The request ended with no HTTP answer at all. */
  | { kind: 'no-answer' };

type SessionFault = 'access_revoked' | 'unauthenticated' | 'session_expired';

type FaultListener = (fault: SessionFault) => void;

const listeners = new Set<FaultListener>();

export function onSessionFault(listener: FaultListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announceFault(code: string): void {
  if (code !== 'access_revoked' && code !== 'unauthenticated' && code !== 'session_expired') return;
  for (const listener of listeners) listener(code);
}

export interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly idempotencyKey?: string | null;
  readonly ifMatch?: number | null;
  readonly formData?: FormData;
  readonly signal?: AbortSignal;
  readonly onProgress?: (sent: number, total: number) => void;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<ApiOutcome<T>> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.formData !== undefined) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey !== undefined && options.idempotencyKey !== null) {
    headers['idempotency-key'] = options.idempotencyKey;
  }
  if (options.ifMatch !== undefined && options.ifMatch !== null) {
    headers['if-match'] = `"${options.ifMatch}"`;
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      body,
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch {
    return { kind: 'no-answer' };
  }

  if (response.status === 204) {
    return { kind: 'ok', status: 204, body: undefined as T, etag: null };
  }

  const text = await response.text().catch(() => '');
  let parsed: unknown = null;
  if (text !== '') {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) {
    const errorBody = (parsed ?? {}) as ApiErrorBody;
    if (response.status === 401 && typeof errorBody.error === 'string') {
      announceFault(errorBody.error);
    }
    return { kind: 'error', status: response.status, body: errorBody };
  }
  return {
    kind: 'ok',
    status: response.status,
    body: parsed as T,
    etag: response.headers.get('etag'),
  };
}

/** Uploads a file, reporting bytes sent, so the progress bar follows the request. */
export function upload<T>(
  path: string,
  formData: FormData,
  onProgress: (fraction: number) => void,
): { promise: Promise<ApiOutcome<T>>; abort: () => void } {
  const request = new XMLHttpRequest();
  const promise = new Promise<ApiOutcome<T>>((resolve) => {
    request.open('POST', path);
    request.withCredentials = true;
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    });
    request.addEventListener('load', () => {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(request.responseText) as unknown;
      } catch {
        parsed = null;
      }
      if (request.status >= 200 && request.status < 300) {
        resolve({ kind: 'ok', status: request.status, body: parsed as T, etag: null });
        return;
      }
      const errorBody = (parsed ?? {}) as ApiErrorBody;
      if (request.status === 401 && typeof errorBody.error === 'string') {
        announceFault(errorBody.error);
      }
      resolve({ kind: 'error', status: request.status, body: errorBody });
    });
    request.addEventListener('error', () => resolve({ kind: 'no-answer' }));
    request.addEventListener('abort', () => resolve({ kind: 'no-answer' }));
    request.send(formData);
  });
  return { promise, abort: () => request.abort() };
}

export function fieldErrors(body: ApiErrorBody): Record<string, string> {
  return body.errors ?? {};
}

export function errorCode(outcome: ApiOutcome<unknown>): string | null {
  return outcome.kind === 'error' && typeof outcome.body.error === 'string'
    ? outcome.body.error
    : null;
}
