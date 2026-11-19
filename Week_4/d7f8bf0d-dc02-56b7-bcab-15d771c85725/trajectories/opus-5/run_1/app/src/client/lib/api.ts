import type { ApiErrorBody } from '../../shared/protocol.js';

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error?.message ?? 'Something went wrong.');
    this.name = 'ApiFailure';
    this.status = status;
    this.code = body.error?.code ?? 'server_error';
    this.body = body;
  }
}

export interface PendingWrite {
  method: 'POST' | 'PUT' | 'PATCH';
  path: string;
  body: Record<string, unknown>;
  key: string;
}

/** Returns true when the app has taken the pending request over for a fresh sign-in. */
type Unauthorised = (retry: () => Promise<unknown>) => boolean;

let onUnauthorised: Unauthorised | null = null;

export function setUnauthorisedHandler(handler: Unauthorised): void {
  onUnauthorised = handler;
}

export function newKey(): string {
  return crypto.randomUUID();
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return null;
  return JSON.parse(text) as unknown;
}

async function send(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  key?: string,
): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });

  if (response.ok) return parse(response);
  const payload = (await parse(response)) as ApiErrorBody | null;
  const failure = new ApiFailure(
    response.status,
    payload ?? { error: { code: 'server_error', message: 'Something went wrong.' } },
  );
  if (failure.status === 401 && failure.code === 'session_required' && onUnauthorised) {
    let taken = false;
    const pending = new Promise<unknown>((resolve, reject) => {
      taken = Boolean(
        onUnauthorised?.(async () => {
          try {
            const result = await send(method, path, body, key);
            resolve(result);
            return result;
          } catch (error) {
            reject(error);
            throw error;
          }
        }),
      );
    });
    if (taken) return pending;
  }
  throw failure;
}

export const api = {
  get: <T>(path: string): Promise<T> => send('GET', path) as Promise<T>,
  post: <T>(path: string, body: Record<string, unknown> = {}, key?: string): Promise<T> =>
    send('POST', path, body, key) as Promise<T>,
  put: <T>(path: string, body: Record<string, unknown>, key: string): Promise<T> =>
    send('PUT', path, body, key) as Promise<T>,
  patch: <T>(path: string, body: Record<string, unknown>, key: string): Promise<T> =>
    send('PATCH', path, body, key) as Promise<T>,
};

export function workspacePath(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}`;
}

export function layoutPath(workspaceId: string, layoutId: string): string {
  return `${workspacePath(workspaceId)}/layouts/${encodeURIComponent(layoutId)}`;
}

export function sessionPath(workspaceId: string, sessionId: string): string {
  return `${workspacePath(workspaceId)}/sessions/${encodeURIComponent(sessionId)}`;
}
