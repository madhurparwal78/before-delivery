import type { ApiErrorBody } from '../shared/types.ts';

export class NoResponseError extends Error {
  constructor() {
    super('no response');
  }
}

export interface ApiReply<T> {
  status: number;
  ok: boolean;
  body: T;
  etag: string | null;
  replay: boolean;
  /** The order in which this request was sent, so later answers can be told from earlier ones. */
  sentSeq: number;
}

let sequence = 0;

export function nextSeq(): number {
  sequence += 1;
  return sequence;
}

export function currentSeq(): number {
  return sequence;
}

export interface RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
  ifMatch?: string;
  raw?: { bytes: ArrayBuffer; contentType: string };
}

export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<ApiReply<T>> {
  const sentSeq = nextSeq();
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.raw) {
    headers['Content-Type'] = options.raw.contentType;
    body = options.raw.bytes;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  if (options.ifMatch) headers['If-Match'] = options.ifMatch;
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new NoResponseError();
  }
  let parsed: unknown = null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    parsed = await response.json().catch(() => null);
  }
  return {
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    body: parsed as T,
    etag: response.headers.get('etag'),
    replay: response.headers.get('idempotent-replay') === 'true',
    sentSeq,
  };
}

export function errorCode(body: unknown): string {
  const error = (body as ApiErrorBody | null)?.error;
  return error?.code ?? 'unknown';
}

export function errorFields(body: unknown): Record<string, string> {
  const error = (body as ApiErrorBody | null)?.error;
  return error?.fields ?? {};
}

export function newIdempotencyKey(): string {
  const random = crypto.getRandomValues(new Uint8Array(12));
  return [...random].map((value) => value.toString(16).padStart(2, '0')).join('');
}
