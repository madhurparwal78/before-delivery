import type { ApiError } from '../shared/api.js';
import { signInWithReturn } from '../shared/safeReturn.js';

export class ApiFault extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    override readonly message: string,
    readonly fields: Record<string, string>,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
  }
}

function currentPathAndQuery(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/** A screen whose session has ended goes to sign-in with its own address as the return path. */
export function toSignIn(): void {
  window.location.assign(signInWithReturn(currentPathAndQuery()));
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  bytes?: Uint8Array;
  /** A 401 on a signed-in screen sends the person to sign in. */
  allowUnauthenticated?: boolean;
  signal?: AbortSignal;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.bytes) {
    headers['content-type'] = 'application/octet-stream';
    body = options.bytes as unknown as BodyInit;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body,
    credentials: 'same-origin',
    signal: options.signal,
  });
  if (response.status === 401 && !options.allowUnauthenticated) {
    toSignIn();
    throw new ApiFault(401, 'unauthenticated', 'Sign in to continue.', {}, {});
  }
  const payload = await parse(response);
  if (!response.ok) {
    const error = (payload as ApiError | null)?.error;
    throw new ApiFault(
      response.status,
      error?.code ?? 'server_error',
      error?.message ?? 'Something went wrong on the bench.',
      error?.fields ?? {},
      error?.details ?? {},
    );
  }
  return payload as T;
}
