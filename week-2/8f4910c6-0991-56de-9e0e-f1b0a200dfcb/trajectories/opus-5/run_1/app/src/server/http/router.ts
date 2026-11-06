import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { Role } from '../../shared/types.js';
import type { MemberRow } from '../data/members.js';
import { authenticate } from '../data/members.js';
import { claimKey, releaseKey, requestHash, storeReply } from '../data/idempotency.js';
import { enforceLimit, type Limiter } from '../data/ratelimit.js';
import { isJsonContentType, isMultipartContentType, parseFilePart, readBody, type FilePart } from './body.js';
import {
  badJson,
  forbidden,
  tooLarge,
  idempotencyKeyRequired,
  methodNotAllowed,
  notFound,
  unsupportedMediaType,
} from './errors.js';

const JSON_BODY_LIMIT = 1_000_000;
const MULTIPART_OVERHEAD = 100_000;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type Ctx = {
  method: HttpMethod;
  path: string;
  url: URL;
  params: Record<string, string>;
  headers: IncomingHttpHeaders;
  cookies: Record<string, string>;
  address: string;
  nowMs: number;
  rawBody: Buffer;
  json: Record<string, unknown>;
  file: FilePart | null;
  idempotencyKey: string | null;
  /** Set after step 3 for routes that need a session. */
  member: MemberRow | null;
  sessionToken: string | null;
};

export type Reply = {
  status: number;
  json?: unknown;
  body?: Buffer | string;
  contentType?: string;
  headers?: Record<string, string>;
};

export type Route = {
  method: HttpMethod;
  path: string;
  auth: 'public' | 'session';
  roles?: Role[];
  limiter?: Limiter;
  body?: 'none' | 'json' | 'multipart';
  fileLimitBytes?: number;
  idempotency?: boolean;
  /** Record lookup and visibility, decided before the role check. */
  load?: (ctx: Ctx) => Promise<void>;
  handler: (ctx: Ctx) => Promise<Reply>;
};

type Segment =
  | { kind: 'literal'; value: string }
  | { kind: 'param'; name: string; suffix: string };

type CompiledRoute = Route & { segments: Segment[] };

function compile(route: Route): CompiledRoute {
  const segments = route.path
    .split('/')
    .filter((part) => part.length > 0)
    .map((part): Segment => {
      if (!part.startsWith(':')) return { kind: 'literal', value: part };
      const dot = part.indexOf('.');
      return dot === -1
        ? { kind: 'param', name: part.slice(1), suffix: '' }
        : { kind: 'param', name: part.slice(1, dot), suffix: part.slice(dot) };
    });
  return { ...route, segments };
}

function matchPath(segments: Segment[], parts: string[]): Record<string, string> | null {
  if (segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const part = parts[i];
    if (segment.kind === 'literal') {
      if (segment.value !== part) return null;
      continue;
    }
    if (segment.suffix) {
      if (!part.endsWith(segment.suffix) || part.length <= segment.suffix.length) return null;
      params[segment.name] = decodeURIComponent(part.slice(0, part.length - segment.suffix.length));
      continue;
    }
    if (part.length === 0) return null;
    params[segment.name] = decodeURIComponent(part);
  }
  return params;
}

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add(routes: Route[]): void {
    for (const route of routes) this.routes.push(compile(route));
  }

  /** Steps 1, 405 included, of the error precedence. */
  resolve(method: string, path: string): { route: CompiledRoute; params: Record<string, string> } {
    const parts = path.split('/').filter((part) => part.length > 0);
    const pathMatches: CompiledRoute[] = [];
    for (const route of this.routes) {
      const params = matchPath(route.segments, parts);
      if (!params) continue;
      pathMatches.push(route);
      if (route.method === method) return { route, params };
    }
    if (pathMatches.length > 0) {
      const allow = [...new Set(pathMatches.map((route) => route.method))];
      throw methodNotAllowed(allow);
    }
    throw notFound();
  }
}

function bodyLimit(route: Route): number {
  if (route.body === 'multipart') return (route.fileLimitBytes ?? 0) + MULTIPART_OVERHEAD;
  return JSON_BODY_LIMIT;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function clientAddress(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const header = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (header) {
    const first = header.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** Runs one API request through the one error precedence. */
export async function runRoute(
  route: Route,
  params: Record<string, string>,
  req: IncomingMessage,
  url: URL,
  nowMs: number,
): Promise<Reply> {
  const headers = req.headers;
  const cookies = parseCookies(headers.cookie);
  const address = clientAddress(req);
  const ctx: Ctx = {
    method: route.method,
    path: url.pathname,
    url,
    params,
    headers,
    cookies,
    address,
    nowMs,
    rawBody: Buffer.alloc(0),
    json: {},
    file: null,
    idempotencyKey: null,
    member: null,
    sessionToken: cookies.rb_session ?? null,
  };

  // 2. Rate limit.
  if (route.limiter) await enforceLimit(route.limiter, address, nowMs);

  // 3. Authentication.
  if (route.auth === 'session') {
    ctx.member = await authenticate(ctx.sessionToken, nowMs);
  }

  // 4. Record lookup and visibility.
  if (route.load) await route.load(ctx);

  // 5. Role.
  if (route.roles && (!ctx.member || !route.roles.includes(ctx.member.role))) throw forbidden();

  // 6. Size, content type, body, idempotency key.
  const kind = route.body ?? 'none';
  if (kind !== 'none') {
    ctx.rawBody = await readBody(req, bodyLimit(route));
    const contentType = headers['content-type'];
    if (kind === 'json') {
      if (!isJsonContentType(contentType)) throw unsupportedMediaType();
      const text = ctx.rawBody.toString('utf8').trim();
      if (text.length > 0) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw badJson();
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw badJson();
        ctx.json = parsed as Record<string, unknown>;
      }
    } else {
      if (!isMultipartContentType(contentType)) throw unsupportedMediaType();
      ctx.file = parseFilePart(ctx.rawBody, contentType ?? '');
      const fileLimit = route.fileLimitBytes ?? 0;
      if (ctx.file && ctx.file.bytes.length > fileLimit) throw tooLarge(fileLimit);
    }
  }

  const keyHeader = headers['idempotency-key'];
  const key = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
  ctx.idempotencyKey = key?.trim() ? key.trim() : null;
  if (route.idempotency && !ctx.idempotencyKey) throw idempotencyKeyRequired();

  if (!route.idempotency || !ctx.idempotencyKey) return route.handler(ctx);

  // 7. Idempotent replay.
  const owner = ctx.member?.id ?? `public:${address}`;
  const hash = requestHash(route.method, url.pathname, ctx.rawBody);
  const outcome = await claimKey(owner, ctx.idempotencyKey, hash);
  if (outcome.kind === 'replay') {
    return {
      status: outcome.reply.status,
      body: outcome.reply.body,
      contentType: 'application/json; charset=utf-8',
      headers: { 'Idempotent-Replayed': 'true' },
    };
  }
  try {
    const reply = await route.handler(ctx);
    if (reply.status < 300 && reply.json !== undefined) {
      await storeReply(owner, ctx.idempotencyKey, {
        status: reply.status,
        body: JSON.stringify(reply.json),
      });
    } else {
      await releaseKey(owner, ctx.idempotencyKey);
    }
    return reply;
  } catch (error) {
    // A refusal stores nothing, so a corrected body may be sent under the key.
    await releaseKey(owner, ctx.idempotencyKey);
    throw error;
  }
}
