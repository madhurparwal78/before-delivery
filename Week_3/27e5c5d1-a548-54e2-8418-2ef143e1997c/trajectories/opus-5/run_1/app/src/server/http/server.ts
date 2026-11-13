import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { MAX_JSON_BODY, MAX_UPLOAD_BYTES, WORKER_ID } from '../config';
import { db } from '../db/repo';
import type { UserRow } from '../db/repo';
import { bytesMatchDeclaredType } from '../domain/attachments';
import { routes } from '../routes';
import { SESSION_COOKIE } from '../routes/session';
import { Ctx } from './context';
import { ApiError, errors } from './errors';
import { boundaryOf, parseFileParts } from './multipart';
import { matchRoute, type Route } from './router';
import { hashToken } from '../lib/crypto';

const PUBLIC_DIR = resolve(__dirname, '..', '..', 'public');

const STATIC_TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

const PAGE_PATTERNS: readonly string[][] = [
  ['signin'],
  [],
  ['boards', '*'],
  ['cards', '*'],
  ['workspaces', '*', 'permission-log'],
];

function isPageRoute(path: string): boolean {
  const parts = path.split('/').filter((segment) => segment.length > 0);
  return PAGE_PATTERNS.some(
    (pattern) =>
      pattern.length === parts.length &&
      pattern.every((segment, index) => segment === '*' || segment === parts[index]),
  );
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

async function readRequestBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(declared) && declared > limit) throw errors.tooLarge();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) throw errors.tooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function checkOrigin(req: IncomingMessage): void {
  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD') return;
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw errors.crossOrigin();
  }
  if (originHost !== req.headers.host) throw errors.crossOrigin();
}

function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  return value.split(';')[0]?.trim().toLowerCase() === 'application/json';
}

function checkContentType(req: IncomingMessage, route: Route): void {
  const method = req.method ?? 'GET';
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') return;
  const contentType = req.headers['content-type'];
  if (route.upload) {
    const value = contentType ?? '';
    if (!value.toLowerCase().startsWith('multipart/form-data')) throw errors.unsupportedMediaType();
    return;
  }
  if (!isJsonContentType(contentType)) throw errors.unsupportedMediaType();
}

async function attachSession(ctx: Ctx): Promise<void> {
  const token = cookieValue(ctx.req.headers.cookie, SESSION_COOKIE);
  if (token === null || token === '') return;
  const tokenHash = hashToken(token);
  const user = await db.queryOne<UserRow>(
    `select u.* from sessions s join users u on u.id = s.user_id where s.token_hash = $1`,
    [tokenHash],
  );
  if (user === null) return;
  ctx.setUser(user, { tokenHash, userId: user.id });
}

function readUploadPart(ctx: Ctx): void {
  const contentType = ctx.req.headers['content-type'] ?? '';
  const boundary = boundaryOf(contentType);
  if (boundary === null) throw errors.unsupportedMediaType();
  const part = parseFileParts(ctx.rawBody, boundary).find((candidate) => candidate.fieldName === 'file');
  if (part === undefined) return;
  if (part.bytes.length > MAX_UPLOAD_BYTES) throw errors.tooLarge();
  if (!bytesMatchDeclaredType(part.contentType, part.bytes)) throw errors.unsupportedMediaType();
  ctx.file = part;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const match = matchRoute(routes, url.pathname);
  if (match === null) throw errors.notFound();
  const { route } = match;
  const method = req.method ?? 'GET';
  const handler = route.methods[method];
  const limit = route.upload ? MAX_UPLOAD_BYTES + 65_536 : MAX_JSON_BODY;
  const declared = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(declared) && declared > limit) throw errors.tooLarge();
  if (handler !== undefined) checkContentType(req, route);
  checkOrigin(req);
  const body = await readRequestBody(req, limit);
  const ctx = new Ctx(req, res, method, url, body);
  ctx.params = match.params;
  if (route.upload && handler !== undefined) readUploadPart(ctx);
  await attachSession(ctx);
  if (!route.open && ctx.session === null) throw errors.signedOut();
  if (handler === undefined) throw errors.methodNotAllowed(Object.keys(route.methods).sort());
  await handler(ctx);
}

async function serveStatic(path: string, res: ServerResponse): Promise<boolean> {
  const extension = path.slice(path.lastIndexOf('.'));
  const type = STATIC_TYPES[extension];
  if (type === undefined) return false;
  const allowed = path === '/app.js' || path === '/app.css' || path.startsWith('/fonts/');
  if (!allowed || path.includes('..')) return false;
  try {
    const bytes = await readFile(join(PUBLIC_DIR, path));
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length });
    res.end(bytes);
    return true;
  } catch {
    return false;
  }
}

let shell: Buffer | null = null;

async function servePage(res: ServerResponse): Promise<void> {
  if (shell === null) shell = await readFile(join(PUBLIC_DIR, 'index.html'));
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': shell.length });
  res.end(shell);
}

function sendError(res: ServerResponse, error: unknown): void {
  const api = error instanceof ApiError ? error : errors.internal();
  if (!(error instanceof ApiError)) {
    process.stderr.write(`kinfold: unexpected failure (${api.status})\n`);
  }
  if (res.headersSent) {
    res.end();
    return;
  }
  const text = JSON.stringify(api.body());
  res.writeHead(api.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...api.headers,
  });
  res.end(text);
}

export function createApp(): Server {
  return createServer((req, res) => {
    res.setHeader('X-Kinfold-Worker', WORKER_ID);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        if (url.pathname.startsWith('/api/')) {
          await handleApi(req, res, url);
          return;
        }
        const method = req.method ?? 'GET';
        if (method !== 'GET' && method !== 'HEAD') throw errors.notFound();
        if (await serveStatic(url.pathname, res)) return;
        if (isPageRoute(url.pathname)) {
          await servePage(res);
          return;
        }
        throw errors.notFound();
      } catch (error) {
        sendError(res, error);
      }
    })();
  });
}
