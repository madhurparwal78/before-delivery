import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Role } from '../../domain/sections.js';
import { serverNow } from '../clock.js';
import { ApiError, apiError, forbidden, unauthenticated } from './errors.js';

export const JSON_BODY_LIMIT = 65_536;
export const UPLOAD_BODY_LIMIT = 26_000_000;
export const SESSION_COOKIE = 'saltprint_session';

export interface SignedInPerson {
  id: string;
  name: string;
  email: string;
  role: Role;
  newsroomSlug: string | null;
  contributorHandle: string | null;
}

export interface Reply {
  status: number;
  json?: unknown;
  body?: Buffer | string;
  contentType?: string;
  headers?: Record<string, string>;
}

export interface RequestContext {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: NodeJS.Dict<string | string[]>;
  rawBody: Buffer;
  person: SignedInPerson | null;
  sessionId: string | null;
  now(): Promise<Date>;
  cookies: Record<string, string>;
}

export interface Route {
  method: string;
  pattern: string;
  roles?: Role[];
  anonymous?: boolean;
  upload?: boolean;
  handle(ctx: RequestContext): Promise<Reply>;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

export function sessionCookie(id: string): string {
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function matchRoute(routes: Route[], method: string, path: string): { route: Route; params: Record<string, string> } | null {
  const segments = path.split('/').filter((part) => part.length > 0);
  for (const route of routes) {
    if (route.method !== method) continue;
    const patternSegments = route.pattern.split('/').filter((part) => part.length > 0);
    if (patternSegments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < patternSegments.length; index += 1) {
      const expected = patternSegments[index] as string;
      const actual = segments[index] as string;
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

export async function readBody(req: IncomingMessage, limit: number, tooLarge: ApiError): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    throw tooLarge;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) {
      req.destroy();
      throw tooLarge;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function payloadTooLarge(): ApiError {
  return apiError(413, 'payload_too_large', 'That request body is too large.');
}

export function fileTooLarge(): ApiError {
  return apiError(413, 'file_too_large', 'An original may be at most 25,000,000 bytes.');
}

export function unsupportedMediaType(): ApiError {
  return apiError(415, 'unsupported_media_type', 'Send application/json.');
}

export function crossOrigin(): ApiError {
  return apiError(403, 'cross_origin', 'Saltprint Desk serves its own origin only.');
}

export function isStateChanging(method: string): boolean {
  return method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE';
}

export function requireSession(ctx: RequestContext): SignedInPerson {
  if (!ctx.person) throw unauthenticated();
  return ctx.person;
}

export function requireRole(ctx: RequestContext, ...roles: Role[]): SignedInPerson {
  const person = requireSession(ctx);
  if (!roles.includes(person.role)) throw forbidden();
  return person;
}

export function requireNewsroom(person: SignedInPerson): string {
  if (!person.newsroomSlug) throw forbidden();
  return person.newsroomSlug;
}

export function jsonBody(ctx: RequestContext): unknown {
  if (ctx.rawBody.length === 0) return {};
  try {
    return JSON.parse(ctx.rawBody.toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

export function buildContext(
  req: IncomingMessage,
  path: string,
  query: URLSearchParams,
  params: Record<string, string>,
  rawBody: Buffer,
): RequestContext {
  const cookies = parseCookies(req.headers.cookie);
  return {
    method: req.method ?? 'GET',
    path,
    query,
    params,
    headers: req.headers,
    rawBody,
    person: null,
    sessionId: cookies[SESSION_COOKIE] ?? null,
    now: serverNow,
    cookies,
  };
}

export function sendReply(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...(reply.headers ?? {}) };
  let payload: Buffer;
  if (reply.json !== undefined) {
    headers['content-type'] = 'application/json; charset=utf-8';
    payload = Buffer.from(JSON.stringify(reply.json), 'utf8');
  } else if (reply.body !== undefined) {
    if (reply.contentType) headers['content-type'] = reply.contentType;
    payload = Buffer.isBuffer(reply.body) ? reply.body : Buffer.from(reply.body, 'utf8');
  } else {
    payload = Buffer.alloc(0);
  }
  headers['content-length'] = String(payload.length);
  headers['x-content-type-options'] = 'nosniff';
  res.writeHead(reply.status, headers);
  if (reply.status === 204) {
    res.end();
    return;
  }
  res.end(payload);
}
