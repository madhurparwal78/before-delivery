import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { JSON_BODY_MAX } from './config';
import { isDatabaseDown } from './db';
import { forbidden, HttpError, unauthenticated } from './errors';
import { DEFAULT_LOCALE, type Locale } from '../shared/format';

export interface SessionUser extends Locale {
  id: number;
  email: string;
  name: string;
}

export interface Upload {
  fileName: string;
  data: Buffer;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  /** The parsed JSON body (null when there is none). */
  body: unknown;
  upload: Upload | null;
  user: SessionUser | null;
  /** The signed-in person, or a 401. */
  need: () => SessionUser;
  locale: Locale;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string | string[]>;
  raw?: Buffer;
}

export type Handler = (ctx: Ctx) => Promise<Reply | unknown> | Reply | unknown;

export const created = (body: unknown): Reply => ({ status: 201, body });
export const accepted = (body: unknown): Reply => ({ status: 202, body });

interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  handler: Handler;
  options: RouteOptions;
}

export interface RouteOptions {
  /** Routes that take a multipart file instead of JSON. */
  multipart?: boolean;
  /** Larger body ceiling, for the grading seed. */
  bodyMax?: number;
}

const routes: Route[] = [];

export function route(method: string, path: string, handler: Handler, options: RouteOptions = {}): void {
  const names: string[] = [];
  const pattern = new RegExp('^' + path.replace(/:(\w+)/g, (_, name: string) => (names.push(name), '([^/]+)')) + '/?$');
  routes.push({ method, pattern, names, handler, options });
}

function isReply(value: unknown): value is Reply {
  return typeof value === 'object' && value !== null && 'status' in value && typeof (value as Reply).status === 'number';
}

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | string[]> = { ...reply.headers };
  if (reply.raw) {
    res.writeHead(reply.status, headers);
    res.end(reply.raw);
    return;
  }
  if (reply.body === undefined) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  headers['content-type'] = 'application/json; charset=utf-8';
  res.writeHead(reply.status, headers);
  res.end(JSON.stringify(reply.body));
}

export const sendError = (res: ServerResponse, error: HttpError): void => send(res, { status: error.status, body: error.body });

function readBody(req: IncomingMessage, limit: number): Promise<Buffer | 'too_large'> {
  return new Promise((resolveBody, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    const chunks: Buffer[] = [];
    let size = 0;
    let over = declared > limit;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) over = true;
      else if (!over) chunks.push(chunk);
    });
    req.on('end', () => resolveBody(over ? 'too_large' : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(body: Buffer, contentType: string): Upload | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const marker = boundary ? Buffer.from('--' + (boundary[1] ?? boundary[2] ?? '')) : null;
  if (!marker) return null;
  let start = body.indexOf(marker);
  while (start >= 0) {
    const next = body.indexOf(marker, start + marker.length);
    if (next < 0) return null;
    const part = body.subarray(start + marker.length + 2, next - 2);
    const split = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, split).toString('utf8');
    const disposition = /content-disposition:[^\r\n]*name="file"(?:;\s*filename="([^"]*)")?/i.exec(head);
    if (disposition) return { fileName: disposition[1] ?? 'file', data: part.subarray(split + 4) };
    start = next;
  }
  return null;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of (header ?? '').split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) cookies[pair.slice(0, at).trim()] = decodePart(pair.slice(at + 1).trim()) ?? '';
  }
  return cookies;
}

export const newToken = (bytes = 24): string => randomBytes(bytes).toString('base64url');

export type SessionLookup = (token: string | undefined) => Promise<SessionUser | null>;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

export interface ServerSetup {
  publicDir: string;
  lookupSession: SessionLookup;
  /** True when the path is a page whose document should answer 404 (an ended link). */
  pageStatus: (path: string) => Promise<number>;
  ready: () => Promise<boolean>;
}

function serveStatic(res: ServerResponse, dir: string, path: string): boolean {
  const target = resolve(join(dir, normalize(path)));
  if (!target.startsWith(resolve(dir) + '/') || !existsSync(target) || !statSync(target).isFile()) return false;
  res.writeHead(200, { 'content-type': TYPES[extname(target)] ?? 'application/octet-stream', 'cache-control': 'public, max-age=3600' });
  createReadStream(target).pipe(res);
  return true;
}

export function createApp(setup: ServerSetup): Server {
  return createServer((req, res) => {
    void dispatch(req, res, setup).catch((error: unknown) => {
      if (res.headersSent) return res.end();
      if (error instanceof HttpError) return sendError(res, error);
      if (isDatabaseDown(error)) return send(res, { status: 503, body: { error: 'database_unavailable' } });
      process.stderr.write(`${req.method} ${req.url} failed: ${String((error as Error).stack ?? error)}\n`);
      return send(res, { status: 500, body: { error: 'internal' } });
    });
  });
}

async function dispatch(req: IncomingMessage, res: ServerResponse, setup: ServerSetup): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://local');
  const method = req.method ?? 'GET';
  const path = url.pathname;
  if (!path.startsWith('/api/')) return page(req, res, setup, path, method);
  if (path === '/api/health') return matchRoute(req, res, setup, url, method);
  if (!(await setup.ready())) return send(res, { status: 503, body: { error: 'database_unavailable' } });
  return matchRoute(req, res, setup, url, method);
}

async function page(req: IncomingMessage, res: ServerResponse, setup: ServerSetup, path: string, method: string): Promise<void> {
  if (method !== 'GET' && method !== 'HEAD') return send(res, { status: 405, body: { error: 'method_not_allowed' } });
  if (serveStatic(res, setup.publicDir, path)) return;
  if (/\.\w{1,5}$/.test(path) || path.startsWith('/assets/') || path.startsWith('/fonts/')) return send(res, { status: 404, body: { error: 'not_found' } });
  const status = (await setup.ready()) ? await setup.pageStatus(path) : 200;
  const shell = join(setup.publicDir, 'index.html');
  res.writeHead(status, { 'content-type': TYPES['.html'] ?? '', 'cache-control': 'no-store' });
  createReadStream(shell).pipe(res);
  void req;
}

/** Decodes one path segment; null when it is malformed or holds a NUL byte, which no stored value can match. */
export function decodePart(raw: string): string | null {
  try {
    const value = decodeURIComponent(raw);
    return value.includes('\u0000') ? null : value;
  } catch {
    return null;
  }
}

async function matchRoute(req: IncomingMessage, res: ServerResponse, setup: ServerSetup, url: URL, method: string): Promise<void> {
  const path = url.pathname;
  if (path.startsWith('/api/share/') && method !== 'GET' && method !== 'HEAD') {
    return sendError(res, forbidden('This link is read only'));
  }
  const origin = req.headers.origin;
  if (method !== 'GET' && method !== 'HEAD' && origin !== undefined && origin !== `http://${req.headers.host}` && new URL(origin).host !== req.headers.host) {
    return sendError(res, forbidden('Cross-origin request refused'));
  }
  let found: { route: Route; params: Record<string, string> } | undefined;
  let pathMatched = false;
  for (const candidate of routes) {
    const match = candidate.pattern.exec(path);
    if (!match) continue;
    pathMatched = true;
    if (candidate.method !== method) continue;
    const decoded = candidate.names.map((_, i) => decodePart(match[i + 1] ?? ''));
    if (decoded.some((value) => value === null)) return send(res, { status: 404, body: { error: 'not_found' } });
    found = { route: candidate, params: Object.fromEntries(candidate.names.map((name, i) => [name, decoded[i] ?? ''])) };
    break;
  }
  if (!found) return send(res, { status: pathMatched ? 405 : 404, body: { error: pathMatched ? 'method_not_allowed' : 'not_found' } });
  const { route: matched, params } = found;
  let body: unknown = null;
  let upload: Upload | null = null;
  if (method !== 'GET' && method !== 'HEAD') {
    const type = (req.headers['content-type'] ?? '').toLowerCase();
    const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
    if (hasBody && !(matched.options.multipart ? type.startsWith('multipart/form-data') : type.startsWith('application/json'))) {
      req.resume();
      return send(res, { status: 415, body: { error: 'unsupported_media_type' } });
    }
    const raw = await readBody(req, matched.options.multipart ? Number.MAX_SAFE_INTEGER : (matched.options.bodyMax ?? JSON_BODY_MAX));
    if (raw === 'too_large') return send(res, { status: 413, body: { error: 'too_large' }, headers: { connection: 'close' } });
    if (matched.options.multipart) upload = parseMultipart(raw, req.headers['content-type'] ?? '');
    else if (raw.length > 0) {
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        return send(res, { status: 400, body: { error: 'bad_request' } });
      }
    }
  }
  const user = await setup.lookupSession(parseCookies(req.headers.cookie).sid);
  const ctx: Ctx = {
    req,
    res,
    params,
    query: url.searchParams,
    body,
    upload,
    user,
    locale: user ?? DEFAULT_LOCALE,
    need: () => {
      if (!user) throw unauthenticated();
      return user;
    },
  };
  const result = await matched.handler(ctx);
  if (res.writableEnded || res.headersSent) return;
  send(res, isReply(result) ? result : { status: 200, body: result });
}

