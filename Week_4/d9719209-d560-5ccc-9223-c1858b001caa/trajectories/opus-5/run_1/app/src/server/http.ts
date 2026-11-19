import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../core/config.js';
import { databaseReady } from '../core/db.js';
import { ApiError, errors } from '../core/errors.js';
import { SESSION_COOKIE, memberForSession } from '../domain/auth.js';
import { buildViewer, type Member, type Viewer } from '../domain/viewer.js';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  params: Record<string, string>;
  nonce: string;
  sessionToken: string | null;
  member: Member | null;
  viewer: Viewer;
  body: Record<string, unknown>;
  rawBody: Buffer;
}

export type Handler = (ctx: Ctx) => Promise<void>;

export interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  /** JSON body endpoints are the ones that enforce the JSON content type. */
  bodyKind: 'json' | 'multipart' | 'none';
}

export function route(method: string, pattern: string, handler: Handler, bodyKind: Route['bodyKind'] = 'json'): Route {
  return { method, segments: pattern.split('/').filter((part) => part !== ''), handler, bodyKind };
}

export function matchRoute(routes: Route[], method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  const parts = pathname.split('/').filter((part) => part !== '');
  let methodMatched = false;
  for (const candidate of routes) {
    if (candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < candidate.segments.length; index += 1) {
      const segment = candidate.segments[index];
      const value = parts[index];
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(value);
      else if (segment !== value) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    methodMatched = true;
    if (candidate.method === method) return { route: candidate, params };
  }
  if (methodMatched) throw errors.notFound('Not found');
  return null;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function baseHeaders(): Record<string, string> {
  return { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
}

export function sendJson(ctx: Ctx, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  ctx.res.writeHead(status, {
    ...baseHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...headers,
  });
  ctx.res.end(payload);
}

export function sendHtml(ctx: Ctx, status: number, html: string): void {
  ctx.res.writeHead(status, {
    ...baseHeaders(),
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
    'Content-Security-Policy': [
      "default-src 'self'",
      `script-src 'self' 'nonce-${ctx.nonce}'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  });
  ctx.res.end(html);
}

export function sendNoContent(ctx: Ctx, headers: Record<string, string> = {}): void {
  ctx.res.writeHead(204, { ...baseHeaders(), ...headers });
  ctx.res.end();
}

export function setSessionCookie(ctx: Ctx, token: string): void {
  const secure = (ctx.req.headers['x-forwarded-proto'] ?? '') === 'https';
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=2592000',
  ];
  if (secure) parts.push('Secure');
  ctx.res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(ctx: Ctx): void {
  ctx.res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Every error answer comes from the shared shape; an unexpected failure says nothing more. */
export function sendError(ctx: Ctx, error: unknown): void {
  if (error instanceof ApiError) {
    const headers: Record<string, string> =
      error.retryAfter === undefined ? {} : { 'Retry-After': String(error.retryAfter) };
    sendJson(ctx, error.status, error.body(), headers);
    return;
  }
  process.stderr.write(`request failed: ${(error as Error).message}\n`);
  sendJson(ctx, 500, { error: { code: 'SERVICE_UNAVAILABLE', message: 'Something went wrong' } });
}

/** Reads a body up to its limit, draining the rest so the oversize answer still reaches the client. */
async function readBody(ctx: Ctx, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overflowed = false;
    ctx.req.on('data', (chunk: Buffer) => {
      if (overflowed) return;
      size += chunk.length;
      if (size > limit) {
        overflowed = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    ctx.req.on('end', () => {
      if (overflowed) {
        reject(errors.validation('That request body is too large', { body: 'That request body is too large' }, 413));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    ctx.req.on('error', reject);
  });
}

const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];

/** Origin, then body size, then content type: the first two steps of the error precedence. */
export async function applyBoundary(ctx: Ctx, kind: Route['bodyKind'], skipOrigin: boolean): Promise<void> {
  if (!skipOrigin && MUTATING.includes(ctx.method)) {
    const origin = ctx.req.headers.origin;
    if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(origin).host === ctx.req.headers.host;
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin) throw errors.forbidden('That request came from another origin');
    }
  }

  if (kind === 'none') return;

  const contentType = String(ctx.req.headers['content-type'] ?? '');
  if (kind === 'multipart') {
    ctx.rawBody = await readBody(ctx, config.limits.maxImageBytes + config.json.multipartOverheadBytes);
    if (!contentType.startsWith('multipart/form-data')) {
      throw errors.validation('Send the image as multipart/form-data', { file: 'Send the image as multipart/form-data' }, 415);
    }
    return;
  }

  ctx.rawBody = await readBody(ctx, config.json.maxBodyBytes);
  if (ctx.rawBody.length === 0) {
    ctx.body = {};
    return;
  }
  if (!contentType.split(';')[0].trim().startsWith('application/json')) {
    throw errors.validation('Send this request as application/json', { body: 'Send this request as application/json' }, 415);
  }
  try {
    const parsed: unknown = JSON.parse(ctx.rawBody.toString('utf8'));
    ctx.body = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw errors.validation('That request body is not valid JSON', { body: 'That request body is not valid JSON' });
  }
}

export async function loadSession(ctx: Ctx): Promise<void> {
  const cookies = parseCookies(ctx.req.headers.cookie);
  const token = cookies[SESSION_COOKIE] ?? null;
  ctx.sessionToken = token;
  const lookup = token ? await memberForSession(token) : null;
  const member = lookup && (!lookup.revoked || lookup.member.suspendedAt !== null) ? lookup.member : null;
  ctx.member = member;
  ctx.viewer = await buildViewer(member);
}

export function requireDatabase(): void {
  if (!databaseReady()) throw errors.serviceUnavailable('The database is unavailable');
}

export function requireMember(ctx: Ctx): Member {
  if (!ctx.member) throw errors.unauthenticated('Sign in to continue');
  return ctx.member;
}

export function requireVerified(ctx: Ctx, message: string): Member {
  const member = requireMember(ctx);
  if (!member.emailVerified) throw new ApiError('EMAIL_UNVERIFIED', message);
  return member;
}

export function newNonce(): string {
  return randomBytes(16).toString('base64');
}

export function createCtx(req: IncomingMessage, res: ServerResponse): Ctx {
  const host = req.headers.host ?? `localhost:${config.port}`;
  return {
    req,
    res,
    url: new URL(req.url ?? '/', `http://${host}`),
    method: req.method ?? 'GET',
    params: {},
    nonce: newNonce(),
    sessionToken: null,
    member: null,
    viewer: { member: null, moderatorOf: new Set() },
    body: {},
    rawBody: Buffer.alloc(0),
  };
}
