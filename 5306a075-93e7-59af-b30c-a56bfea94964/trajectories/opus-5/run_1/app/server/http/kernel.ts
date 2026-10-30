import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Role } from '../../shared/types';
import { pool, type Queryable } from '../db';
import { env } from '../env';
import {
  AppError,
  crossOrigin,
  forbidden,
  internalError,
  methodNotAllowed,
  notFound,
  payloadTooLarge,
  unauthenticated,
  unsupportedMediaType,
} from '../errors';
import { SESSION_COOKIE, resolveSession, type Principal } from '../repo/session';
import { StorageUnavailableError } from '../services/storage';
import { storageUnavailable } from '../errors';

export const MAX_JSON_BYTES = 1_000_000;
export const MAX_MULTIPART_BYTES = 11_000_000;

export interface RequestContext {
  method: string;
  url: URL;
  params: Record<string, string>;
  body: Record<string, unknown>;
  rawBody: Buffer;
  contentType: string;
  headers: IncomingMessage['headers'];
  principal: Principal | null;
  sessionToken: string | null;
  db: Queryable;
}

export interface Reply {
  status: number;
  json?: unknown;
  bytes?: Buffer;
  html?: string;
  contentType?: string;
  headers?: Record<string, string>;
  setSession?: string | null;
}

export type Handler<T> = (ctx: RequestContext, resolved: T) => Promise<Reply>;

export interface Route<T = undefined> {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  pattern: string;
  /** `public` routes skip the 401 check. */
  access: 'public' | 'member';
  roles?: readonly Role[];
  /** Resolves path ids, raising 404 before any role check. */
  resolve?: (ctx: RequestContext) => Promise<T>;
  handle: Handler<T>;
  multipart?: true;
}

interface CompiledRoute {
  route: Route<unknown>;
  segments: string[];
}

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add<T>(route: Route<T>): void {
    this.routes.push({ route: route as Route<unknown>, segments: route.pattern.split('/') });
  }

  private match(
    method: string,
    pathSegments: string[],
  ): { route: Route<unknown>; params: Record<string, string> } | 'method' | null {
    let pathExists = false;
    for (const compiled of this.routes) {
      if (compiled.segments.length !== pathSegments.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < compiled.segments.length; i += 1) {
        const expected = compiled.segments[i];
        if (expected.startsWith(':')) {
          if (pathSegments[i] === '') {
            ok = false;
            break;
          }
          params[expected.slice(1)] = decodeURIComponent(pathSegments[i]);
          continue;
        }
        if (expected !== pathSegments[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      pathExists = true;
      if (compiled.route.method === method) return { route: compiled.route, params };
    }
    return pathExists ? 'method' : null;
  }

  async dispatch(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    const method = request.method ?? 'GET';
    const segments = pathname.split('/');
    const matched = this.match(method, segments);
    if (matched === null) return false;

    try {
      if (matched === 'method') throw methodNotAllowed();
      const reply = await this.run(request, matched.route, matched.params, pathname);
      writeReply(response, reply);
    } catch (error) {
      writeReply(response, errorReply(error, pathname));
    }
    return true;
  }

  private async run(
    request: IncomingMessage,
    route: Route<unknown>,
    params: Record<string, string>,
    pathname: string,
  ): Promise<Reply> {
    const method = request.method ?? 'GET';
    const limit = route.multipart ? MAX_MULTIPART_BYTES : MAX_JSON_BYTES;
    const rawBody = await readBody(request, limit);
    // Kept verbatim: a multipart boundary is case-sensitive.
    const contentType = request.headers['content-type'] ?? '';

    if (WRITE_METHODS.has(method) && rawBody.length > 0) {
      const expected = route.multipart ? 'multipart/form-data' : 'application/json';
      if (!contentType.toLowerCase().startsWith(expected)) throw unsupportedMediaType();
    }

    const body = route.multipart || rawBody.length === 0 ? {} : parseJsonObject(rawBody);
    const cookies = parseCookies(request.headers.cookie ?? '');
    const sessionToken = cookies[SESSION_COOKIE] ?? null;
    const principal = sessionToken ? await resolveSession(sessionToken) : null;

    if (route.access === 'member' && principal === null) throw unauthenticated();

    const ctx: RequestContext = {
      method,
      url: new URL(request.url ?? pathname, 'http://evidence-desk.invalid'),
      params,
      body,
      rawBody,
      contentType,
      headers: request.headers,
      principal,
      sessionToken,
      db: pool,
    };

    const resolved = route.resolve ? await route.resolve(ctx) : undefined;

    if (WRITE_METHODS.has(method)) {
      const origin = request.headers.origin;
      if (typeof origin === 'string' && origin !== '' && !isOwnOrigin(origin, request.headers.host)) {
        throw crossOrigin();
      }
    }

    if (route.roles && (principal === null || !route.roles.includes(principal.role))) throw forbidden();

    return route.handle(ctx, resolved);
  }
}

function isOwnOrigin(origin: string, host: string | undefined): boolean {
  const allowed = new Set([new URL(env.baseUrl).origin]);
  if (host !== undefined && host !== '') {
    allowed.add(`http://${host}`);
    allowed.add(`https://${host}`);
  }
  return allowed.has(origin);
}

export function parseCookies(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

function parseJsonObject(raw: Buffer): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw unsupportedMediaType();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw unsupportedMediaType();
  return parsed as Record<string, unknown>;
}

function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) {
    request.resume();
    return Promise.reject(payloadTooLarge());
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        reject(payloadTooLarge());
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', (error) => reject(error));
  });
}

export const PUBLIC_PAGE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
};

function isPublicSurface(pathname: string): boolean {
  return pathname.startsWith('/api/public/') || pathname === '/r' || pathname.startsWith('/r/');
}

export function errorReply(error: unknown, pathname: string): Reply {
  const appError =
    error instanceof AppError
      ? error
      : error instanceof StorageUnavailableError
        ? storageUnavailable()
        : (process.stderr.write(`${String(error instanceof Error ? error.stack : error)}\n`), internalError());
  return {
    status: appError.status,
    json: appError.body(),
    headers: isPublicSurface(pathname) ? { ...PUBLIC_PAGE_HEADERS } : undefined,
  };
}

export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; " +
  "connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'";

export function writeReply(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    ...(reply.headers ?? {}),
  };
  if (reply.setSession !== undefined) {
    headers['Set-Cookie'] =
      reply.setSession === null
        ? `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
        : `${SESSION_COOKIE}=${reply.setSession}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${env.sessionIdleSeconds}`;
  }
  if (reply.html !== undefined) {
    headers['Content-Type'] = 'text/html; charset=utf-8';
    headers['Content-Security-Policy'] = CSP;
    response.writeHead(reply.status, headers);
    response.end(reply.html);
    return;
  }
  if (reply.bytes !== undefined) {
    headers['Content-Type'] = reply.contentType ?? 'application/octet-stream';
    response.writeHead(reply.status, headers);
    response.end(reply.bytes);
    return;
  }
  if (reply.json === undefined) {
    response.writeHead(reply.status, headers);
    response.end();
    return;
  }
  headers['Content-Type'] = 'application/json; charset=utf-8';
  response.writeHead(reply.status, headers);
  response.end(JSON.stringify(reply.json));
}

export function requirePrincipal(ctx: RequestContext): Principal {
  if (ctx.principal === null) throw unauthenticated();
  return ctx.principal;
}

export function notFoundUnless<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw notFound();
  return value;
}
