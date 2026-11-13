import type { ErrorBody } from './types.ts';

const REPLY_TIMEOUT_MS = 20_000;

/** A request that ended without any HTTP reply. */
export class NoReply extends Error {
  constructor() {
    super('No reply from the server');
  }
}

export type Sent<T> =
  | { ok: true; status: number; data: T; etag: string | null }
  | { ok: false; status: number; error: ErrorBody };

export type Options = {
  body?: unknown;
  bytes?: { data: ArrayBuffer | Uint8Array; contentType: string };
  ifMatch?: number;
  key?: string;
};

export async function send<T>(
  method: string,
  path: string,
  options: Options = {},
): Promise<Sent<T>> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (options.bytes !== undefined) {
    headers['content-type'] = options.bytes.contentType;
    payload = options.bytes.data as BodyInit;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }
  if (options.ifMatch !== undefined) headers['if-match'] = `"${options.ifMatch}"`;
  if (options.key !== undefined) headers['idempotency-key'] = options.key;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: payload,
      credentials: 'same-origin',
      signal: AbortSignal.timeout(REPLY_TIMEOUT_MS),
    });
  } catch {
    throw new NoReply();
  }
  if (response.status === 204) {
    return { ok: true, status: 204, data: undefined as T, etag: null };
  }
  const text = await response.text();
  const parsed: unknown = text === '' ? {} : JSON.parse(text);
  if (!response.ok) {
    return { ok: false, status: response.status, error: parsed as ErrorBody };
  }
  return {
    ok: true,
    status: response.status,
    data: parsed as T,
    etag: response.headers.get('etag'),
  };
}

export async function read<T>(path: string): Promise<T | null> {
  const reply = await send<T>('GET', path);
  return reply.ok ? reply.data : null;
}

export function newKey(): string {
  return crypto.randomUUID();
}
