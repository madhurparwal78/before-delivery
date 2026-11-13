import { anchorServerTime } from './clock';
import { currentEpoch } from './state';
import type { ApiErrorBody } from '../shared/types';

export interface ApiOk<T> {
  kind: 'ok';
  status: number;
  body: T;
  replay: boolean;
}

export interface ApiFail {
  kind: 'error';
  status: number;
  error: string;
  message: string;
  fields: Record<string, string>;
  retryAfterSeconds: number | null;
}

export interface ApiNetwork {
  kind: 'network';
}

export interface ApiStale {
  kind: 'stale';
}

export type ApiResult<T> = ApiOk<T> | ApiFail | ApiNetwork | ApiStale;

export interface RequestOptions {
  body?: unknown;
  form?: FormData;
  idempotencyKey?: string;
  /** Set only by the start-up probe, which may legitimately find no session. */
  silentUnauthenticated?: boolean;
}

let onSessionEnded: (() => void) | null = null;

export function handleSessionEnd(handler: () => void): void {
  onSessionEnded = handler;
}

function anchorIfPresent(body: unknown): void {
  if (body !== null && typeof body === 'object' && 'now' in body) {
    const now = (body as { now?: unknown }).now;
    if (typeof now === 'string') anchorServerTime(now);
  }
}

/** The one path every browser request takes, tagged with the sign-in it was sent under. */
export async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const epoch = currentEpoch();
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.form !== undefined) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey !== undefined) headers['idempotency-key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    if (epoch !== currentEpoch()) return { kind: 'stale' };
    return { kind: 'network' };
  }
  if (epoch !== currentEpoch()) return { kind: 'stale' };

  const text = await response.text().catch(() => '');
  let parsed: unknown = null;
  if (text !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (response.ok) {
    anchorIfPresent(parsed);
    return {
      kind: 'ok',
      status: response.status,
      body: parsed as T,
      replay: response.headers.get('idempotent-replay') === 'true',
    };
  }

  const error = (parsed ?? {}) as ApiErrorBody;
  if (response.status === 401 && error.error === 'unauthenticated' && options.silentUnauthenticated !== true) {
    onSessionEnded?.();
  }
  const retryAfter = response.headers.get('retry-after');
  return {
    kind: 'error',
    status: response.status,
    error: error.error ?? 'internal_error',
    message: error.message ?? '',
    fields: error.fields ?? {},
    retryAfterSeconds: retryAfter === null ? null : Number(retryAfter),
  };
}
