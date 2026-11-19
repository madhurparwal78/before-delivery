import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { ApiError, apiError, forbidden, notFound, unauthenticated } from './errors.js';
import { parseJsonObject, type JsonObject } from './json.js';
import type { Role } from '../domain/landing.js';

export const JSON_BODY_LIMIT = 64_000;
export const MEMO_BODY_LIMIT = 5_000_000;

export const MEMO_CONTENT_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
] as const;

export interface SessionInfo {
  readonly token: string;
  readonly role: Role;
  readonly coachId: string | null;
  readonly enrollmentId: string | null;
  readonly name: string;
}

export interface RequestContext {
  readonly method: string;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly body: JsonObject;
  readonly rawBody: Buffer;
  readonly headers: IncomingHttpHeaders;
  readonly session: SessionInfo | null;
  readonly now: Date;
}

export interface ApiResponse {
  readonly status: number;
  readonly json?: unknown;
  readonly bytes?: Buffer;
  readonly headers?: Record<string, string>;
  readonly setSession?: string;
  readonly clearSession?: boolean;
}

export interface Route {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly body: 'json' | 'memo' | 'none';
  readonly auth: 'public' | 'session' | 'dreamer' | 'coach';
  readonly uuidParams?: readonly string[];
  readonly handler: (ctx: RequestContext) => Promise<ApiResponse>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function matchRoute(
  routes: readonly Route[],
  method: string,
  pathname: string,
): { route: Route; params: Record<string, string> } | null {
  const segments = pathname.split('/').filter((part) => part !== '');
  for (const route of routes) {
    if (route.method !== method) continue;
    const pattern = route.path.split('/').filter((part) => part !== '');
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < pattern.length; index += 1) {
      const expected = pattern[index];
      const actual = segments[index];
      if (expected === undefined || actual === undefined) {
        matched = false;
        break;
      }
      if (expected.startsWith(':')) {
        params[expected.slice(1)] = decodeURIComponent(actual);
        continue;
      }
      if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | null {
  const value = headers[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

export function ownOrigin(headers: IncomingHttpHeaders, encrypted: boolean): string {
  const host = headerValue(headers, 'host') ?? '';
  return `${encrypted ? 'https' : 'http'}://${host}`;
}

export function failsSameOrigin(headers: IncomingHttpHeaders, encrypted: boolean): boolean {
  const origin = headerValue(headers, 'origin');
  if (origin !== null) return origin !== ownOrigin(headers, encrypted);
  return headerValue(headers, 'sec-fetch-site') === 'cross-site';
}

function baseContentType(headers: IncomingHttpHeaders): string {
  const raw = headerValue(headers, 'content-type') ?? '';
  const [base] = raw.split(';');
  return (base ?? '').trim().toLowerCase();
}

export function memoContentType(headers: IncomingHttpHeaders): string | null {
  const raw = headerValue(headers, 'content-type');
  if (raw === null) return null;
  const base = baseContentType(headers);
  return (MEMO_CONTENT_TYPES as readonly string[]).includes(base) ? raw : null;
}

function carriesBody(headers: IncomingHttpHeaders): boolean {
  if (headerValue(headers, 'transfer-encoding') !== null) return true;
  const length = headerValue(headers, 'content-length');
  return length !== null && Number(length) > 0;
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  let overLimit = false;
  for await (const chunk of request) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += piece.length;
    if (size > limit) {
      overLimit = true;
      continue;
    }
    chunks.push(piece);
  }
  if (overLimit) throw apiError(413, 'payload_too_large');
  return Buffer.concat(chunks);
}

const STATE_CHANGING = ['POST', 'PUT', 'PATCH', 'DELETE'];

export interface Dispatcher {
  readonly routes: readonly Route[];
  readonly loadSession: (token: string) => Promise<SessionInfo | null>;
}

export async function dispatch(
  dispatcher: Dispatcher,
  request: IncomingMessage,
  url: URL,
  sessionToken: string | null,
): Promise<ApiResponse> {
  const method = request.method ?? 'GET';
  const match = matchRoute(dispatcher.routes, method, url.pathname);
  if (match === null) throw notFound();
  const { route, params } = match;
  const headers = request.headers;
  const encrypted = 'encrypted' in request.socket && request.socket.encrypted === true;

  if (STATE_CHANGING.includes(method) && failsSameOrigin(headers, encrypted)) {
    throw apiError(403, 'cross_origin');
  }

  let rawBody: Buffer = Buffer.alloc(0);
  let body: JsonObject = {};
  const skipBodyRungs =
    method === 'GET' || route.body === 'none' || (route.body === 'json' && !carriesBody(headers));

  if (skipBodyRungs) {
    request.resume();
  } else if (route.body === 'json') {
    rawBody = await readBody(request, JSON_BODY_LIMIT);
    if (baseContentType(headers) !== 'application/json') {
      throw apiError(415, 'unsupported_media_type');
    }
    const parsed = parseJsonObject(rawBody.toString('utf8'));
    if (parsed === null) throw apiError(400, 'invalid_json');
    body = parsed;
  } else {
    rawBody = await readBody(request, MEMO_BODY_LIMIT);
    if (memoContentType(headers) === null) throw apiError(415, 'unsupported_media_type');
  }

  let session: SessionInfo | null = null;
  if (sessionToken !== null) session = await dispatcher.loadSession(sessionToken);

  if (route.auth !== 'public') {
    if (session === null) throw unauthenticated();
    if (route.auth === 'dreamer' && session.role !== 'dreamer') throw forbidden();
    if (route.auth === 'coach' && session.role !== 'coach') throw forbidden();
  }

  for (const name of route.uuidParams ?? []) {
    const value = params[name];
    if (value === undefined || !isUuid(value)) throw notFound();
  }

  return route.handler({
    method,
    url,
    params,
    body,
    rawBody,
    headers,
    session,
    now: new Date(),
  });
}

export function errorResponse(error: unknown): ApiResponse {
  if (error instanceof ApiError) return { status: error.status, json: error.body };
  return { status: 500, json: { error: 'internal_error' } };
}
