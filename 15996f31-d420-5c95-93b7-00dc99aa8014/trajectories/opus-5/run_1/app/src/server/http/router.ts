import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type { Role } from '../../shared/labels';
import { ApiError, ProviderUnavailable, apiError } from './errors';

export const SESSION_COOKIE = 'bloom_session';
const JSON_BODY_LIMIT = 64_000;
export const PHOTO_BYTE_LIMIT = 8_000_000;
const MULTIPART_READ_LIMIT = PHOTO_BYTE_LIMIT + 600_000;

export interface Actor {
  id: string;
  personName: string;
  businessName: string;
  contactName: string;
  email: string;
  role: Role;
}

export interface RequestBody {
  json: Record<string, unknown>;
  raw: Buffer;
  overLimit: boolean;
  contentType: string;
}

export interface Ctx {
  url: URL;
  params: Record<string, string>;
  headers: IncomingHttpHeaders;
  body: RequestBody;
  actor: Actor | null;
}

export interface Reply {
  status: number;
  json?: unknown;
  bytes?: Buffer;
  headers?: Record<string, string>;
  setCookie?: string;
}

export type BodyMode = 'none' | 'json' | 'multipart';

export interface Route {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body: BodyMode;
  auth: 'public' | 'session';
  handle(ctx: Ctx): Promise<Reply>;
}

interface CompiledRoute extends Route {
  segments: string[];
}

export function requireActor(ctx: Ctx): Actor {
  if (ctx.actor === null) throw apiError.unauthenticated();
  return ctx.actor;
}

export function requireRole(ctx: Ctx, ...roles: readonly Role[]): Actor {
  const actor = requireActor(ctx);
  if (!roles.includes(actor.role)) throw apiError.forbidden();
  return actor;
}

export function compileRoutes(routes: readonly Route[]): CompiledRoute[] {
  return routes.map((route) => ({ ...route, segments: route.path.split('/').filter(Boolean) }));
}

export function matchRoute(
  routes: readonly CompiledRoute[],
  method: string,
  pathname: string,
): { route: CompiledRoute; params: Record<string, string> } | null {
  const parts = pathname.split('/').filter(Boolean);
  let pathMatched = false;
  for (const route of routes) {
    if (route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < route.segments.length; index += 1) {
      const segment = route.segments[index] as string;
      const value = parts[index] as string;
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(value);
      else if (segment !== value) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    pathMatched = true;
    if (route.method === method) return { route, params };
  }
  if (pathMatched) throw apiError.notFound();
  return null;
}

export function readCookie(headers: IncomingHttpHeaders, name: string): string | null {
  const header = headers.cookie;
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

/** Rejects a non-GET request whose Origin header names another origin. */
export function isCrossOriginWrite(method: string, headers: IncomingHttpHeaders): boolean {
  if (method === 'GET' || method === 'HEAD') return false;
  const origin = headers.origin;
  if (origin === undefined || origin === 'null') return false;
  const host = headers.host;
  if (host === undefined) return true;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

const DRAIN_ALLOWANCE = 16_000_000;

/**
 * Reads the body up to the limit; a larger body is drained so that the refusal
 * can still be written, and only an absurd one has its socket cut.
 */
async function collect(
  request: IncomingMessage,
  limit: number,
): Promise<{ data: Buffer; over: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) {
      over = true;
      if (size > limit + DRAIN_ALLOWANCE) {
        request.destroy();
        break;
      }
      continue;
    }
    chunks.push(buffer);
  }
  return { data: Buffer.concat(chunks), over };
}

export async function readBody(request: IncomingMessage, mode: BodyMode): Promise<RequestBody> {
  /* The multipart boundary is case sensitive, so the header is kept verbatim. */
  const contentType = request.headers['content-type'] ?? '';
  if (mode === 'none') {
    return { json: {}, raw: Buffer.alloc(0), overLimit: false, contentType };
  }
  if (mode === 'multipart') {
    const { data, over } = await collect(request, MULTIPART_READ_LIMIT);
    return { json: {}, raw: data, overLimit: over, contentType };
  }
  const { data, over } = await collect(request, JSON_BODY_LIMIT);
  if (over) throw apiError.payloadTooLarge();
  if (data.length === 0) return { json: {}, raw: data, overLimit: false, contentType };
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw apiError.unsupportedMediaType();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString('utf8')) as unknown;
  } catch {
    throw apiError.unsupportedMediaType();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw apiError.unsupportedMediaType();
  }
  return {
    json: parsed as Record<string, unknown>,
    raw: data,
    overLimit: false,
    contentType,
  };
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ProviderUnavailable) return error.toApiError();
  return new ApiError(500, 'internal_error', 'Something went wrong on our side.');
}

export function sendReply(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    ...(reply.headers ?? {}),
  };
  if (reply.setCookie !== undefined) headers['Set-Cookie'] = reply.setCookie;
  if (reply.json !== undefined) {
    const payload = Buffer.from(JSON.stringify(reply.json), 'utf8');
    headers['Content-Type'] = 'application/json; charset=utf-8';
    headers['Content-Length'] = String(payload.length);
    response.writeHead(reply.status, headers);
    response.end(payload);
    return;
  }
  if (reply.bytes !== undefined) {
    headers['Content-Length'] = String(reply.bytes.length);
    response.writeHead(reply.status, headers);
    response.end(reply.bytes);
    return;
  }
  response.writeHead(reply.status, headers);
  response.end();
}
