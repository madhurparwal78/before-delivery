// Request handling: the server boundary, routing, locale, cookies and signed sessions.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type Locale } from '../shared/catalog.js';
import { copy, type Messages } from '../shared/copy.js';
import { config } from './config.js';
import { ApiError } from './errors.js';

const MAX_BODY_BYTES = 65536;
const SESSION_HOURS = 12;

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface Ctx {
  req: IncomingMessage;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  locale: Locale;
  m: Messages;
  body: unknown;
  cookies: Record<string, string>;
  now: Date;
  outCookies: string[];
}

type Handler = (ctx: Ctx) => Promise<Reply>;

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
}

const routes: Route[] = [];
const immutablePaths: RegExp[] = [];

export function route(method: string, path: string, handler: Handler): void {
  const pattern = new RegExp(`^${path.replace(/\{(\w+)\}/g, '(?<$1>[^/]+)')}$`);
  routes.push({ method, pattern, handler });
}

/** Paths whose other methods answer 405 audit_immutable instead of method_not_allowed. */
export function immutable(path: string): void {
  immutablePaths.push(new RegExp(`^${path.replace(/\{(\w+)\}/g, '[^/]+')}$`));
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/** The active locale: the pdl_locale cookie, else fr-CA when Accept-Language starts with fr, else en-CA. */
export function requestLocale(cookies: Record<string, string>, acceptLanguage: string | undefined): Locale {
  const cookie = cookies.pdl_locale;
  if (cookie === 'fr-CA' || cookie === 'en-CA') return cookie;
  return (acceptLanguage ?? '').trim().toLowerCase().startsWith('fr') ? 'fr-CA' : 'en-CA';
}

export function cookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

const sign = (payload: string) => createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');

type SessionKind = 'customer' | 'staff';
const SESSION_COOKIE: Record<SessionKind, string> = { customer: 'pdl_session', staff: 'pdl_staff' };

export function startSession(ctx: Ctx, kind: SessionKind, id: number): void {
  const payload = Buffer.from(JSON.stringify({ k: kind, id, exp: ctx.now.getTime() + SESSION_HOURS * 3600_000 })).toString('base64url');
  ctx.outCookies.push(cookie(SESSION_COOKIE[kind], `${payload}.${sign(payload)}`, SESSION_HOURS * 3600));
}

export function endSession(ctx: Ctx, kind: SessionKind): void {
  ctx.outCookies.push(cookie(SESSION_COOKIE[kind], '', 0));
}

/** The id inside a valid, unexpired session cookie of `kind`, or null. */
export function sessionId(cookies: Record<string, string>, kind: SessionKind, now: Date): number | null {
  const value = cookies[SESSION_COOKIE[kind]];
  if (!value) return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  // A valid signature means startSession wrote the payload, so it always parses.
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { k: string; id: number; exp: number };
  return data.k === kind && data.exp > now.getTime() ? data.id : null;
}

async function readBody(req: IncomingMessage): Promise<Buffer | 'too_large'> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return 'too_large';
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function send(res: ServerResponse, reply: Reply, cookies: string[] = []): void {
  const headers: Record<string, string | string[]> = { 'Cache-Control': 'no-store', ...reply.headers };
  if (cookies.length) headers['Set-Cookie'] = cookies;
  if (reply.status === 204 || reply.body === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  const payload = JSON.stringify(reply.body);
  res.writeHead(reply.status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

/** Answers one /api request through the published precedence's boundary, routing and error shape. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const cookies = parseCookies(req.headers.cookie);
  const locale = requestLocale(cookies, req.headers['accept-language']);
  const m = copy(locale);
  const ctx: Ctx = {
    req,
    method: req.method ?? 'GET',
    path: url.pathname,
    query: url.searchParams,
    params: {},
    locale,
    m,
    body: undefined,
    cookies,
    now: new Date(),
    outCookies: [],
  };
  try {
    if (MUTATING.has(ctx.method)) {
      const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
      const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
      if (hasBody && type !== 'application/json') throw new ApiError(415, 'unsupported_media_type', m.unsupportedMedia);
      const raw = await readBody(req);
      if (raw === 'too_large') {
        req.resume();
        // The body is left unread, so the connection cannot carry another request.
        throw new ApiError(413, 'payload_too_large', m.payloadTooLarge, undefined, { Connection: 'close' });
      }
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
        throw new ApiError(403, 'cross_origin', m.crossOrigin);
      }
      if (raw.length > 0) {
        try {
          ctx.body = JSON.parse(raw.toString('utf8'));
        } catch {
          ctx.body = null;
        }
      }
    }
    const matching = routes.filter((r) => r.pattern.test(ctx.path));
    const found = matching.find((r) => r.method === ctx.method);
    if (!found) {
      if (immutablePaths.some((p) => p.test(ctx.path))) throw new ApiError(405, 'audit_immutable', m.auditImmutable);
      if (matching.length) throw new ApiError(405, 'method_not_allowed', m.methodNotAllowed);
      throw new ApiError(404, 'not_found', m.notFoundApi);
    }
    ctx.params = { ...found.pattern.exec(ctx.path)?.groups };
    const reply = await found.handler(ctx);
    send(res, reply, ctx.outCookies);
  } catch (error) {
    if (error instanceof ApiError) {
      send(res, { status: error.status, body: error.body(), headers: error.headers }, ctx.outCookies);
      return;
    }
    console.error(error);
    send(res, { status: 500, body: { error: { code: 'internal', message: m.network } } });
  }
}
