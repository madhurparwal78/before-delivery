import { readFile, stat } from 'node:fs/promises';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config';
import { NOT_FOUND, Refusal } from './errors';

const JSON_LIMIT = 100_000;
export const UPLOAD_LIMIT = 250_000_000;
const TOO_LARGE = 'That request is too large.';
const CROSS_SITE = 'Cross-site requests are refused.';

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}
/** Returned by a handler that wrote the response itself. */
export const STREAMED = Symbol('streamed');

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  json(): Promise<Record<string, unknown>>;
}
type Handler = (ctx: Ctx) => Promise<Reply | typeof STREAMED>;
export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  handler: Handler;
}

/** The value of a `:name` segment of the route that matched; every handler names one its path has. */
export function param(params: Record<string, string>, name: string): string {
  const value = params[name];
  if (value === undefined) throw new Error(`The route has no :${name} segment.`);
  return value;
}

export const reply = (status: number, body?: unknown, headers?: Record<string, string>): Reply => ({ status, body, headers });

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string field without NUL bytes, else undefined. */
export function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && !value.includes('\u0000') ? value : undefined;
}

export function characters(value: string): number {
  return [...value].length;
}

// ---- cookies ----

export const SESSION_COOKIE = 'slatehall_session';

export function cookieOf(headers: IncomingHttpHeaders, name: string): string | undefined {
  for (const part of (headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

export function sessionCookie(token: string, maxAgeSeconds = 60 * 60 * 24 * 30): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

// ---- boundary ----

export function assertSameOrigin(headers: IncomingHttpHeaders): void {
  const origin = headers.origin;
  if (origin === undefined) return;
  let host = '';
  try {
    host = new URL(origin).host;
  } catch {
    host = '';
  }
  if (host !== headers.host) throw new Refusal(403, CROSS_SITE);
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  if (Number(req.headers['content-length'] ?? 0) > limit) throw new Refusal(413, TOO_LARGE);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const piece = chunk as Buffer;
    size += piece.length;
    if (size > limit) throw new Refusal(413, TOO_LARGE);
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new Refusal(415, 'Send JSON.');
  const raw = await readBody(req, JSON_LIMIT);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Refusal(415, 'Send JSON.');
  }
  return isRecord(parsed) ? parsed : {};
}

// ---- routing ----

function split(pathname: string): string[] | null {
  const parts = pathname.split('/').filter((part) => part !== '');
  try {
    const decoded = parts.map((part) => decodeURIComponent(part));
    return decoded.some((part) => part.includes('\u0000')) ? null : decoded;
  } catch {
    return null;
  }
}

export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const wanted = pattern.split('/').filter((part) => part !== '');
  const got = split(pathname);
  if (!got || got.length !== wanted.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < wanted.length; index += 1) {
    const want = wanted[index] ?? '';
    const have = got[index] ?? '';
    if (want.startsWith(':')) params[want.slice(1)] = have;
    else if (want !== have) return null;
  }
  return params;
}

const PAGES = [
  /^\/$/,
  /^\/sign-up$/,
  /^\/sign-in$/,
  /^\/classes$/,
  /^\/classes\/[^/]+$/,
  /^\/classes\/[^/]+\/room$/,
  /^\/lessons\/[^/]+$/,
  /^\/join$/,
  /^\/sessions\/[^/]+$/,
  /^\/sessions\/[^/]+\/summary$/,
  /^\/review\/[^/]+$/,
];
const CLIENT_ROOT = path.resolve(fileURLToPath(new URL('./client/', import.meta.url)));
const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveClient(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const head = req.method === 'HEAD';
  if (pathname.startsWith('/assets/')) {
    const file = path.join(CLIENT_ROOT, pathname);
    const type = TYPES[path.extname(file)];
    const info = file.startsWith(CLIENT_ROOT + path.sep) && type ? await stat(file).catch(() => null) : null;
    if (info?.isFile() && type) {
      res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable' });
      res.end(head ? undefined : await readFile(file));
      return;
    }
    throw new Refusal(404, NOT_FOUND);
  }
  const shell = await readFile(path.join(CLIENT_ROOT, 'index.html')).catch(() => null);
  if (!shell) throw new Refusal(404, NOT_FOUND);
  const known = PAGES.some((page) => page.test(pathname));
  res.writeHead(known ? 200 : 404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(head ? undefined : shell);
}

function writeJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (status === 204) {
    res.writeHead(204, headers);
    res.end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

export const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'content-security-policy':
    // script-src: the app's own scripts, plus one hash-pinned inline script: the accessibility audit's axe-core
    // (genkit/golden_kit/vendor/axe.min.js), which page inspection injects. No other inline script can run.
    "default-src 'self'; script-src 'self' 'sha256-IMCf4Veoo0ow4kGqofza3mV3NPCKs3ns++t9RcxG6Hg='; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};

/** Answers one request: the first route that matches, else the client shell, else 404. */
export async function dispatch(routes: Route[], req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('X-Slatehall-Instance', config.instanceName);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') assertSameOrigin(req.headers);
    let cached: Promise<Record<string, unknown>> | undefined;
    for (const route of routes) {
      const params = route.method === method ? matchPath(route.path, url.pathname) : null;
      if (!params) continue;
      const ctx: Ctx = { req, res, params, json: () => (cached ??= readJson(req)) };
      const result = await route.handler(ctx);
      if (result === STREAMED) return;
      if (!req.readableEnded) req.resume();
      writeJson(res, result.status, result.body, result.headers);
      return;
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) {
      throw new Refusal(404, NOT_FOUND);
    }
    if (method !== 'GET' && method !== 'HEAD') throw new Refusal(404, NOT_FOUND);
    await serveClient(req, res, url.pathname);
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (!req.readableEnded) res.setHeader('Connection', 'close');
    if (error instanceof Refusal) {
      writeJson(res, error.status, { error: error.message });
      return;
    }
    console.error('request failed', error);
    writeJson(res, 500, { error: 'Something went wrong. Try again.' });
  }
}
