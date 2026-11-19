import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { AppError, errorBody, notFound } from './errors.js';
import { SESSION_COOKIE, resolveSession, type Session } from './accounts.js';
import { pool } from './db.js';
import { matchPage } from '../shared/routes.js';

export const STREAMED = Symbol('streamed');

export interface Ctx {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: IncomingHttpHeaders;
  body: unknown;
  file: File | null;
  session: Session;
  token: string | undefined;
  req: IncomingMessage;
  res: ServerResponse;
}

export interface JsonReply { status: number; body?: unknown; headers?: Record<string, string | string[]> }
export interface RawReply { status: number; raw: Buffer; type: string; headers?: Record<string, string> }
export type Reply = JsonReply | RawReply | typeof STREAMED;
export type Handler = (ctx: Ctx) => Promise<Reply>;
type BodyKind = 'json' | 'multipart';

interface Route { method: string; names: string[]; regex: RegExp; handler: Handler; body: BodyKind; checkOrigin: boolean }

const routes: Route[] = [];

export function route(method: string, pattern: string, handler: Handler, options: { body?: BodyKind; checkOrigin?: boolean } = {}): void {
  const names = [...pattern.matchAll(/:(\w+)/g)].map((m) => m[1] as string);
  routes.push({
    method, names, handler, body: options.body ?? 'json', checkOrigin: options.checkOrigin ?? true,
    regex: new RegExp(`^${pattern.replace(/:\w+/g, '([^/]+)')}$`),
  });
}

export const ok = (body: unknown, headers?: JsonReply['headers']): JsonReply => ({ status: 200, body, headers });
export const created = (body: unknown, headers?: JsonReply['headers']): JsonReply => ({ status: 201, body, headers });
export const noContent = (headers?: JsonReply['headers']): JsonReply => ({ status: 204, headers });

const JSON_LIMIT = 100_000;
const MULTIPART_OVERHEAD = 100_000;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLIENT_DIR = path.join(ROOT, 'dist', 'client');
const FONT_DIR = path.join(ROOT, 'public', 'fonts');

export const state = { databaseReady: false };

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

export const sessionCookie = (token: string, maxAgeSeconds: number): string =>
  `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${config.publicUrl.startsWith('https:') ? '; Secure' : ''}`;

function fail(code: 'FORBIDDEN' | 'VALIDATION', message: string, status?: number, fields?: Record<string, string>): AppError {
  return new AppError(code, message, { status, fields });
}

function assertSameOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (origin === undefined) return;
  let host = '';
  try {
    host = new URL(origin).host;
  } catch {
    host = '';
  }
  if (host !== req.headers.host) throw fail('FORBIDDEN', 'Cross-origin requests are not allowed');
}

async function readBody(req: IncomingMessage, limit: number, fileField: boolean): Promise<Buffer> {
  const tooLarge = fail('VALIDATION', fileField ? 'This image is too large' : 'The request body is too large', 413,
    fileField ? { file: 'This image is too large' } : undefined);
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) throw tooLarge;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw tooLarge;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function parseBody(req: IncomingMessage, kind: BodyKind): Promise<{ body: unknown; file: File | null }> {
  const raw = await readBody(req, kind === 'multipart' ? config.limits.maxImageBytes + MULTIPART_OVERHEAD : JSON_LIMIT, kind === 'multipart');
  if (raw.length === 0) return { body: undefined, file: null };
  const type = (req.headers['content-type'] ?? '').toLowerCase();
  if (kind === 'multipart') {
    if (!type.startsWith('multipart/form-data')) throw fail('VALIDATION', 'Send the image as multipart/form-data', 415, { file: 'Use a JPEG, PNG or WebP image' });
    const form = await new Response(new Uint8Array(raw), { headers: { 'content-type': req.headers['content-type'] ?? '' } })
      .formData().catch(() => null);
    const file = form?.get('file');
    return { body: undefined, file: file instanceof File ? file : null };
  }
  if (!type.startsWith('application/json')) throw fail('VALIDATION', 'Send the body as application/json', 415);
  try {
    return { body: JSON.parse(raw.toString('utf8')) as unknown, file: null };
  } catch {
    throw fail('VALIDATION', 'The request body is not valid JSON', 422);
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

function connectionFault(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
  return (code !== undefined && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', '57P01', '08006', '08001', '53300'].includes(code)) ||
    (error instanceof Error && /timeout exceeded when trying to connect|Connection terminated|Client has encountered a connection error/.test(error.message));
}

function sendError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (error instanceof AppError) {
    const headers: Record<string, string> = error.detail.retryAfter === undefined ? {} : { 'Retry-After': String(error.detail.retryAfter) };
    writeJson(res, error.status, errorBody(error), headers);
    return;
  }
  if (connectionFault(error)) {
    writeJson(res, 503, errorBody(new AppError('SERVICE_UNAVAILABLE', 'The service is unavailable right now')));
    return;
  }
  console.error('request failed:', error instanceof Error ? error.stack : error);
  writeJson(res, 500, errorBody(new AppError('INTERNAL', 'Something went wrong on our side')));
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  const matched = routes
    .filter((r) => r.method === method)
    .map((r) => ({ r, found: r.regex.exec(url.pathname) }))
    .find((m) => m.found !== null);
  if (!matched || !matched.found) throw notFound('No such endpoint');
  const { r, found } = matched;
  if (MUTATING.has(method) && r.checkOrigin) assertSameOrigin(req);
  let body: unknown;
  let file: File | null = null;
  if (MUTATING.has(method)) ({ body, file } = await parseBody(req, r.body));
  if (!state.databaseReady && url.pathname !== '/api/health') {
    throw new AppError('SERVICE_UNAVAILABLE', 'The service is starting up. Try again shortly.');
  }
  const token = cookieValue(req.headers.cookie, SESSION_COOKIE);
  const session = state.databaseReady ? await resolveSession(pool, token) : { user: null, suspended: false };
  const params: Record<string, string> = {};
  r.names.forEach((name, i) => { params[name] = decodeURIComponent(found[i + 1] as string); });
  const reply = await r.handler({
    method, path: url.pathname, query: url.searchParams, params, headers: req.headers, body, file, session, token, req, res,
  });
  if (reply === STREAMED) return;
  if ('raw' in reply) {
    res.writeHead(reply.status, {
      'Content-Type': reply.type, 'Content-Length': reply.raw.length, 'X-Content-Type-Options': 'nosniff', ...reply.headers,
    });
    res.end(reply.raw);
    return;
  }
  writeJson(res, reply.status, reply.body, reply.headers);
}

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

async function serveFile(res: ServerResponse, dir: string, name: string, cache: string): Promise<boolean> {
  const full = path.resolve(dir, name);
  if (!full.startsWith(dir + path.sep) || !MIME[path.extname(full)]) return false;
  try {
    const data = await readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full)] as string, 'Content-Length': data.length,
      'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

function shell(nonce: string, status: number, res: ServerResponse): void {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Moothall</title>
<link rel="stylesheet" href="/assets/main.css">
<link rel="preload" href="/fonts/bricolage-grotesque-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/atkinson-hyperlegible-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
</head>
<body>
<div id="root"></div>
<div id="live-status" role="status" aria-live="polite" class="sr-only"></div>
<div id="live-alert" role="alert" class="sr-only"></div>
<noscript>Moothall needs JavaScript to run.</noscript>
<script type="module" src="/assets/main.js" nonce="${nonce}"></script>
</body>
</html>
`;
  const csp = [
    "default-src 'self'", `script-src 'self' 'nonce-${nonce}'`, "style-src 'self'", "img-src 'self' data: blob:",
    "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ');
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Content-Security-Policy': csp,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(html);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) {
    await handleApi(req, res, url);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') throw notFound();
  if (url.pathname.startsWith('/assets/') && await serveFile(res, CLIENT_DIR, url.pathname.slice('/assets/'.length), 'no-cache')) return;
  if (url.pathname.startsWith('/fonts/') && await serveFile(res, FONT_DIR, url.pathname.slice('/fonts/'.length), 'public, max-age=31536000, immutable')) return;
  shell(randomBytes(16).toString('base64'), matchPage(url.pathname) ? 200 : 404, res);
}

export function createServer(): http.Server {
  return http.createServer((req, res) => {
    handleRequest(req, res).catch((error: unknown) => sendError(res, error));
  });
}
