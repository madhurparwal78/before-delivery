import type { ApiErrorBody } from '../shared/api.js';

export interface ApiRequest {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  bodyText?: string;
  form?: FormData;
  idempotencyKey?: string;
}

export type ApiOutcome<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'error'; body: ApiErrorBody }
  | { kind: 'network' }
  | { kind: 'unauthenticated' }
  | { kind: 'abandoned' };

export function jsonRequest(
  method: 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): ApiRequest {
  const request: ApiRequest = { method, path };
  if (body !== undefined) request.bodyText = JSON.stringify(body);
  if (idempotencyKey !== undefined) request.idempotencyKey = idempotencyKey;
  return request;
}

async function raw<T>(request: ApiRequest): Promise<ApiOutcome<T>> {
  const headers: Record<string, string> = {};
  if (request.bodyText !== undefined) headers['content-type'] = 'application/json';
  if (request.idempotencyKey !== undefined) {
    headers['idempotency-key'] = request.idempotencyKey;
  }
  const init: RequestInit = { method: request.method, headers, credentials: 'same-origin' };
  if (request.bodyText !== undefined) init.body = request.bodyText;
  else if (request.form !== undefined) init.body = request.form;

  let response: Response;
  try {
    response = await fetch(request.path, init);
  } catch {
    return { kind: 'network' };
  }
  if (response.status === 204) return { kind: 'ok', data: undefined as T };
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { kind: 'network' };
  }
  if (response.ok) return { kind: 'ok', data: payload as T };
  const body = payload as ApiErrorBody;
  if (body.error === 'unauthenticated') return { kind: 'unauthenticated' };
  return { kind: 'error', body };
}

type SessionGate = () => Promise<boolean>;

let sessionGate: SessionGate | null = null;

export function registerSessionGate(gate: SessionGate | null): void {
  sessionGate = gate;
}

/**
 * A user action answered as unauthenticated opens Sign in to continue and, once the user
 * has signed in again, is resent once with the same method, path, body and key.
 */
export async function sendAction<T>(request: ApiRequest): Promise<ApiOutcome<T>> {
  const first = await raw<T>(request);
  if (first.kind !== 'unauthenticated') return first;
  if (sessionGate === null) return first;
  const signedIn = await sessionGate();
  if (!signedIn) return { kind: 'abandoned' };
  return raw<T>(request);
}

export async function sendRefetch<T>(path: string): Promise<ApiOutcome<T>> {
  return raw<T>({ method: 'GET', path });
}

export async function downloadThroughLink(url: string, fileName: string): Promise<ApiOutcome<null>> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'same-origin' });
  } catch {
    return { kind: 'network' };
  }
  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { kind: 'network' };
    }
    const body = payload as ApiErrorBody;
    if (body.error === 'unauthenticated') return { kind: 'unauthenticated' };
    return { kind: 'error', body };
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
  return { kind: 'ok', data: null };
}

let actionsFinished = 0;

export function noteActionFinished(): void {
  actionsFinished += 1;
}

export function refetchToken(): number {
  return actionsFinished;
}

/** A refetch is applied only when no user action finished after it was requested. */
export function tokenIsFresh(token: number): boolean {
  return token === actionsFinished;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
