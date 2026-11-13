import { createServer, ServerResponse, STATUS_CODES, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { READER_COOKIE, SESSION_COOKIE, principalForToken, type Principal } from './auth';
import { ApiError, fail } from './errors';
import { copy } from '../shared/copy';
import { messageHtml } from './views/document';
import { acceptWebSocket, type Sink } from './websocket';
import { limits } from '../shared/rules';
import type { Role } from '../shared/types';

type Access = 'public' | 'member' | 'editor' | 'owner';
type BodyKind = 'none' | 'json' | 'image' | 'openapi';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  /** The parsed JSON body of a `json` route; an empty object when none was sent. */
  json: Record<string, unknown>;
  /** The raw body of an `image` or `openapi` route. */
  raw: Buffer;
  principal: Principal | null;
}

export type Reply =
  | { kind: 'bytes'; status: number; body: Buffer | string; contentType: string; headers: Record<string, string | string[]> }
  | { kind: 'stream'; open: (sink: Sink) => void };

export const reply = {
  json: (status: number, data: unknown, headers: Record<string, string | string[]> = {}): Reply => ({
    kind: 'bytes',
    status,
    body: JSON.stringify(data),
    contentType: 'application/json; charset=utf-8',
    headers,
  }),
  empty: (status: number, headers: Record<string, string | string[]> = {}): Reply => ({
    kind: 'bytes',
    status,
    body: '',
    contentType: 'text/plain; charset=utf-8',
    headers,
  }),
  html: (status: number, body: string, headers: Record<string, string | string[]> = {}): Reply => ({
    kind: 'bytes',
    status,
    body,
    contentType: 'text/html; charset=utf-8',
    headers,
  }),
  redirect: (status: number, location: string, headers: Record<string, string | string[]> = {}): Reply => ({
    kind: 'bytes',
    status,
    body: '',
    contentType: 'text/plain; charset=utf-8',
    headers: { location, ...headers },
  }),
  bytes: (status: number, body: Buffer, contentType: string, headers: Record<string, string | string[]> = {}): Reply => ({
    kind: 'bytes',
    status,
    body,
    contentType,
    headers,
  }),
  stream: (open: (sink: Sink) => void): Reply => ({ kind: 'stream', open }),
};

/** A route prepared for one request: the resource is located, and the call to the handler is ready to make. */
interface Route {
  method: string;
  segments: string[];
  access: Access;
  body: BodyKind;
  api: boolean;
  prepare: (ctx: Ctx) => Promise<() => Promise<Reply>>;
}

const routes: Route[] = [];

/** What a handler receives: signed-in routes always carry the principal. */
export type Signed = Ctx & { principal: Principal };
type Context<A extends Access> = A extends 'public' ? Ctx : Signed;

interface Definition<Scope, A extends Access> {
  access: A;
  body?: BodyKind;
  /** Locate the resource named by the path (404 for an unknown one or one of another team). */
  prepare?: (ctx: Context<A>) => Promise<Scope>;
  handle: (ctx: Context<A>, scope: Scope) => Promise<Reply>;
}

function add<Scope, A extends Access>(api: boolean, method: string, pattern: string, definition: Definition<Scope, A>): void {
  routes.push({
    method,
    segments: pattern.split('/').filter(Boolean),
    access: definition.access,
    body: definition.body ?? 'none',
    api,
    // The dispatcher has already put a principal on `ctx` for every route that is not public, and Scope is
    // undefined exactly when a definition has no `prepare`.
    prepare: async (ctx) => {
      const context = ctx as Context<A>;
      const scope = (definition.prepare ? await definition.prepare(context) : undefined) as Scope;
      return () => definition.handle(context, scope);
    },
  });
}

/** Register an API endpoint: every failure it can raise is rendered in the one error shape. */
export function endpoint<Scope = undefined, A extends Access = Access>(method: string, pattern: string, definition: Definition<Scope, A>): void {
  add(true, method, pattern, definition);
}

/** Register a page route: its failures are shown as pages, and a signed-out visitor is sent to sign in. */
export function pageRoute<Scope = undefined, A extends Access = Access>(pattern: string, definition: Definition<Scope, A>): void {
  add(false, 'GET', pattern, definition);
}

function match(route: Route, method: string, segments: string[]): Record<string, string> | null {
  if (route.method !== method) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let index = 0; index < route.segments.length; index += 1) {
    const expected = route.segments[index] ?? '';
    if (expected.startsWith('*')) {
      params[expected.slice(1)] = segments.slice(index).join('/');
      return params;
    }
    const actual = segments[index];
    if (actual === undefined) {
      return null;
    }
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = actual;
    } else if (expected !== actual) {
      return null;
    }
  }
  return segments.length === route.segments.length ? params : null;
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const found: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) {
      found[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return found;
}

function cookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export const sessionCookie = (token: string): string => cookie(SESSION_COOKIE, token, 60 * 60 * 24 * 30);
export const clearedSessionCookie = (): string => cookie(SESSION_COOKIE, '', 0);
export const readerCookie = (id: string): string => cookie(READER_COOKIE, id, 60 * 60 * 24 * 365);

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

interface BodyRule {
  limit: number;
  tooLarge: string;
  unsupported: string;
  accepts: (contentType: string) => boolean;
}

const bodyRules: Record<Exclude<BodyKind, 'none'>, BodyRule> = {
  json: { limit: limits.json, tooLarge: 'The request body is larger than 1,000,000 bytes.', unsupported: 'Send the body as application/json.', accepts: (t) => t === 'application/json' },
  openapi: { limit: limits.openapi, tooLarge: copy.importTooLarge, unsupported: 'Send the file as application/json.', accepts: (t) => t === 'application/json' },
  image: { limit: limits.image, tooLarge: copy.imageSize, unsupported: copy.imageType, accepts: (t) => IMAGE_TYPES.has(t) },
};

async function readBody(req: IncomingMessage, kind: Exclude<BodyKind, 'none'>): Promise<Buffer> {
  const rule = bodyRules[kind];
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > rule.limit) {
    throw fail.tooLarge(rule.tooLarge);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > rule.limit) {
      throw fail.tooLarge(rule.tooLarge);
    }
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks);
  const contentType = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (body.length > 0 && !rule.accepts(contentType)) {
    throw fail.mediaType(rule.unsupported);
  }
  return body;
}

function parseJson(raw: Buffer): Record<string, unknown> {
  if (raw.length === 0) {
    return {};
  }
  const text = raw.toString('utf8');
  if (/\\u0000/i.test(text) || text.includes('\0')) {
    throw fail.validation({ body: 'The request body cannot contain NUL characters.' });
  }
  try {
    const value: unknown = JSON.parse(text);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // fall through to the validation error below
  }
  throw fail.validation({ body: 'The request body must be a JSON object.' });
}

function authorised(access: Access, role: Role): boolean {
  if (access === 'owner') {
    return role === 'owner';
  }
  return access !== 'editor' || role !== 'viewer';
}

const SAFE_METHODS = new Set(['GET', 'HEAD']);

/** Whether the request names no origin, or the origin of this host. */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) {
    return true;
  }
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false; // an unparseable origin names no host of ours
  }
}

function checkOrigin(req: IncomingMessage): void {
  if (!SAFE_METHODS.has(req.method ?? 'GET') && !sameOrigin(req)) {
    throw fail.crossOrigin();
  }
}

async function principalOf(req: IncomingMessage): Promise<Principal | null> {
  const token = cookies(req)[SESSION_COOKIE];
  return token ? principalForToken(token) : null;
}

const errorReply = (error: unknown, api: boolean): Reply => {
  const refusal = error instanceof ApiError ? error : new ApiError('internal_error', 'Something went wrong.');
  if (!(error instanceof ApiError)) {
    console.error(error);
  }
  return api
    ? reply.json(refusal.status, refusal.body())
    : reply.html(refusal.status, messageHtml({ title: `${refusal.status}`, heading: refusal.message, text: '', mark: 'caret' }));
};

async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<Reply> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://galley.local');
  const api = url.pathname.split('/')[1] === 'api';
  let segments: string[];
  try {
    segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    decodeURIComponent(url.search);
  } catch {
    return errorReply(fail.notFound(), api);
  }
  if (segments.some((segment) => segment.includes('\0')) || url.search.toLowerCase().includes('%00')) {
    return errorReply(fail.notFound(), api);
  }
  const lookup = method === 'HEAD' ? 'GET' : method;
  for (const route of routes) {
    const params = match(route, lookup, segments);
    if (params === null) {
      continue;
    }
    const ctx: Ctx = { req, res, url, params, json: {}, raw: Buffer.alloc(0), principal: null };
    try {
      if (route.body === 'none') {
        req.resume();
      } else {
        ctx.raw = await readBody(req, route.body);
      }
      if (route.access !== 'public') {
        ctx.principal = await principalOf(req);
        if (ctx.principal === null) {
          if (route.api) {
            throw fail.unauthenticated();
          }
          return reply.redirect(302, `/signin?next=${encodeURIComponent(url.pathname + url.search)}`);
        }
      }
      const act = await route.prepare(ctx);
      if (ctx.principal !== null && !authorised(route.access, ctx.principal.role)) {
        throw fail.forbiddenRole();
      }
      checkOrigin(req);
      if (route.body === 'json') {
        ctx.json = parseJson(ctx.raw);
      }
      return await act();
    } catch (error) {
      return errorReply(error, route.api);
    }
  }
  return errorReply(fail.notFound(), api);
}

/** The same live stream as server-sent events, for a plain GET (the brief's transport); the app's own pages use the WebSocket. */
function eventStreamSink(res: ServerResponse): Sink {
  return {
    write: (text) => {
      const { event, data } = JSON.parse(text) as { event: string; data: unknown };
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    ping: () => {
      res.write(': ping\n\n');
    },
    onClose: (listener) => {
      res.on('close', listener);
    },
  };
}

function send(req: IncomingMessage, res: ServerResponse, result: Reply): void {
  if (result.kind === 'stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': open\n\n');
    result.open(eventStreamSink(res));
    return;
  }
  const body = typeof result.body === 'string' ? Buffer.from(result.body) : result.body;
  res.writeHead(result.status, {
    'Content-Type': result.contentType,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...result.headers,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const STATIC_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

/** Serve files from `root` under /static: only the extensions above, never a path that climbs out. */
async function serveStatic(root: string, pathname: string): Promise<Reply> {
  const relative = normalize(pathname.replace(/^\/static\//, ''));
  const type = STATIC_TYPES[extname(relative)];
  if (type === undefined || relative.startsWith('..') || relative.includes('\0')) {
    return errorReply(fail.notFound(), false);
  }
  try {
    const body = await readFile(join(root, relative));
    return reply.bytes(200, body, type, { 'Cache-Control': extname(relative) === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache' });
  } catch {
    return errorReply(fail.notFound(), false);
  }
}

function refuseUpgrade(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? 'Refused'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/** A live event stream: the same route, sign-in and role checks as any request, then the socket is handed to it. */
async function upgrade(req: IncomingMessage, socket: Duplex): Promise<void> {
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string' || req.headers.upgrade?.toLowerCase() !== 'websocket' || !sameOrigin(req)) {
    refuseUpgrade(socket, 400);
    return;
  }
  const result = await dispatch(req, new ServerResponse(req));
  if (result.kind !== 'stream') {
    refuseUpgrade(socket, result.kind === 'bytes' ? result.status : 400);
    return;
  }
  result.open(acceptWebSocket(key, socket));
}

export function listen(port: number, staticRoot: string): Server {
  const server = createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0] ?? '/';
    const done =
      pathname.startsWith('/static/') && (req.method === 'GET' || req.method === 'HEAD')
        ? serveStatic(staticRoot, pathname)
        : dispatch(req, res);
    done.then((result) => send(req, res, result)).catch((error: unknown) => {
      console.error(error);
      res.destroy();
    });
  });
  server.on('upgrade', (req, socket) => {
    socket.on('error', () => socket.destroy());
    upgrade(req, socket).catch((error: unknown) => {
      console.error(error);
      socket.destroy();
    });
  });
  server.keepAliveTimeout = 65_000;
  server.listen(port, '0.0.0.0');
  return server;
}
