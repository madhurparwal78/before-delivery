/**
 * Talking to the server. The browser never uses cookies: it keeps the bearer
 * token in its own local storage and sends it on every request.
 */

import { NETWORK_FAILURE } from '../domain/copy.ts';

const TOKEN_STORE = 'quillmoor.tokens';
const ACTOR_STORE = 'quillmoor.actor';

type TokenMap = Record<string, string>;

function readTokens(): TokenMap {
  try {
    const raw = window.localStorage.getItem(TOKEN_STORE);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as TokenMap;
  } catch {
    return {};
  }
}

function writeTokens(tokens: TokenMap): void {
  window.localStorage.setItem(TOKEN_STORE, JSON.stringify(tokens));
}

export function storedToken(actorId: string): string | null {
  return readTokens()[actorId] ?? null;
}

export function rememberToken(actorId: string, token: string): void {
  writeTokens({ ...readTokens(), [actorId]: token });
  window.localStorage.setItem(ACTOR_STORE, actorId);
}

export function lastActorId(): string | null {
  return window.localStorage.getItem(ACTOR_STORE);
}

/** A problem answered by the server, carried verbatim to the Problems alert. */
export class ApiProblem extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly errors: Readonly<Record<string, string>>;

  constructor(status: number, code: string, detail: string, errors: Record<string, string>) {
    super(detail);
    this.name = 'ApiProblem';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.errors = errors;
  }
}

/** A request that never reached the server, so nothing is confirmed. */
export class NetworkFailure extends Error {
  constructor() {
    super(NETWORK_FAILURE);
    this.name = 'NetworkFailure';
  }
}

export interface RequestOptions {
  readonly token?: string | null;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly ifMatch?: string;
  readonly signal?: AbortSignal;
}

interface RawReply {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Headers;
}

async function send(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<RawReply> {
  const headers: Record<string, string> = {};
  if (options.token !== undefined && options.token !== null) {
    headers['authorization'] = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotencyKey !== undefined) {
    headers['idempotency-key'] = options.idempotencyKey;
  }
  if (options.ifMatch !== undefined) headers['if-match'] = options.ifMatch;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new NetworkFailure();
  }

  const text = await response.text();
  let body: unknown = null;
  if (text !== '') {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, body, headers: response.headers };
}

function raise(reply: RawReply): never {
  const body = reply.body;
  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>;
    const errors = record['errors'];
    throw new ApiProblem(
      reply.status,
      typeof record['code'] === 'string' ? record['code'] : 'internal_error',
      typeof record['detail'] === 'string' ? record['detail'] : 'Something went wrong.',
      typeof errors === 'object' && errors !== null ? (errors as Record<string, string>) : {},
    );
  }
  throw new ApiProblem(reply.status, 'internal_error', 'Something went wrong.', {});
}

export async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const reply = await send(method, path, options);
  if (reply.status >= 400) raise(reply);
  return reply.body as T;
}

/** A read whose ETag the caller needs, as the risk form does. */
export async function requestWithEtag<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ body: T; etag: string | null }> {
  const reply = await send('GET', path, options);
  if (reply.status >= 400) raise(reply);
  return { body: reply.body as T, etag: reply.headers.get('etag') };
}
