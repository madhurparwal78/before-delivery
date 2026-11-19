/** API client: one fetch wrapper with the shared error shape and 401 queueing. */

export interface ApiErrorShape {
  code: string;
  message: string;
  [key: string]: unknown;
}

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export type WriteBody = Record<string, unknown> | undefined;

interface QueuedCommand {
  method: string;
  path: string;
  body: WriteBody;
  idempotencyKey: string | null;
  resolve: (value: void) => void;
  reject: (reason: ApiFailure) => void;
}

type SignInAgainHandler = () => Promise<void>;

let pendingQueue: QueuedCommand[] = [];
let signingIn: Promise<void> | null = null;
let onSignInAgain: SignInAgainHandler | null = null;

export function setSignInAgainHandler(handler: SignInAgainHandler | null): void {
  onSignInAgain = handler;
}

/** A random idempotency key for a write. */
export function newKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = 'k-';
  for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function rawRequest(method: string, path: string, body: WriteBody, idempotencyKey: string | null, signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (body !== undefined || method !== 'GET') headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    signal,
  });
  if (res.status === 204) return { status: 204, body: null };
  const contentType = res.headers.get('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    return { status: res.status, body: data };
  }
  if (contentType.includes('application/pdf')) {
    const buffer = await res.arrayBuffer();
    return { status: res.status, body: buffer };
  }
  return { status: res.status, body: null };
}

function toFailure(status: number, body: unknown): ApiFailure {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error: ApiErrorShape }).error;
    const { code, message, ...extra } = err;
    return new ApiFailure(status, code, message, extra);
  }
  return new ApiFailure(status, 'internal', 'Something went wrong.');
}

/** Reads throw ApiFailure; a 401 on a write queues the command behind one sign-in. */
export async function api<T>(method: string, path: string, body?: WriteBody, idempotencyKey: string | null = null, signal?: AbortSignal): Promise<T> {
  const isWrite = method !== 'GET';
  let result: { status: number; body: unknown };
  try {
    result = await rawRequest(method, path, body, idempotencyKey, signal);
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiFailure(0, 'network', 'The server did not answer.');
  }
  if (result.status === 401 && isWrite) {
    // Sign in again, then replay once with the same key and body.
    await enqueueForSignIn(method, path, body, idempotencyKey);
    result = await rawRequest(method, path, body, idempotencyKey, signal);
  }
  if (result.status >= 400) {
    throw toFailure(result.status, result.body);
  }
  return result.body as T;
}

function enqueueForSignIn(method: string, path: string, body: WriteBody, idempotencyKey: string | null): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    pendingQueue.push({
      method,
      path,
      body,
      idempotencyKey,
      resolve: () => resolve(),
      reject,
    });
    if (!signingIn) {
      signingIn = (async () => {
        try {
          await onSignInAgain?.();
        } finally {
          const queue = pendingQueue;
          pendingQueue = [];
          signingIn = null;
          for (const item of queue) item.resolve();
        }
      })();
    }
  });
}

/** Flush any queued commands after a manual sign-in. */
export function flushQueued(): void {
  const queue = pendingQueue;
  pendingQueue = [];
  for (const item of queue) item.resolve();
}

/** GET reads answer directly. */
export async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const result = await rawRequest('GET', path, undefined, null, signal);
  if (result.status >= 400) throw toFailure(result.status, result.body);
  return result.body as T;
}
