import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { MAX_BODY_BYTES } from '../shared/types.js';
import { AppError, crossOrigin, notFound, tooLarge, unsupportedMediaType } from './errors.js';
import { handleRoute, type Reply } from './routes.js';
import { SESSION_COOKIE, cookieValue } from './sessions.js';
import { handleUpgrade } from './socket.js';

const publicDir = path.resolve(import.meta.dirname, '..', 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

/** Same-origin check: an Origin header must name this host and port. */
export function originAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  const host = request.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const method = request.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD' || method === 'DELETE') return {};
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw tooLarge();
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim().length === 0) return {};
  const type = (request.headers['content-type'] ?? '').split(';')[0]?.trim();
  if (type !== 'application/json') throw unsupportedMediaType();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError(422, 'invalid');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AppError(422, 'invalid');
  return parsed as Record<string, unknown>;
}

function sendJson(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if (reply.cookie) headers['set-cookie'] = reply.cookie;
  if (reply.body === undefined) {
    response.writeHead(reply.status, headers);
    response.end();
    return;
  }
  const payload = JSON.stringify(reply.body);
  headers['content-type'] = 'application/json; charset=utf-8';
  headers['content-length'] = String(Buffer.byteLength(payload));
  response.writeHead(reply.status, headers);
  response.end(payload);
}

function sendFile(response: ServerResponse, file: string): void {
  const extension = path.extname(file);
  const headers: Record<string, string> = {
    'content-type': MIME[extension] ?? 'application/octet-stream',
    'content-length': String(statSync(file).size),
  };
  headers['cache-control'] = extension === '.html' ? 'no-store' : 'public, max-age=3600';
  response.writeHead(200, headers);
  createReadStream(file).pipe(response);
}

function staticFile(pathname: string): string | null {
  const allowed = pathname.startsWith('/assets/') || pathname.startsWith('/fonts/') || pathname.startsWith('/icons/');
  if (!allowed) return null;
  const file = path.join(publicDir, pathname);
  if (!file.startsWith(publicDir) || !existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

function isPageRoute(pathname: string): boolean {
  return pathname === '/' || pathname === '/sign-in' || /^\/d\/[^/]+$/u.test(pathname);
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (!originAllowed(request)) {
    sendJson(response, { status: 403, body: crossOrigin().body() });
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    try {
      const body = await readBody(request);
      const reply = await handleRoute({
        method: request.method ?? 'GET',
        path: url.pathname,
        searchParams: url.searchParams,
        body,
        sessionId: cookieValue(request.headers.cookie, SESSION_COOKIE),
      });
      sendJson(response, reply);
    } catch (error) {
      if (error instanceof AppError) {
        sendJson(response, { status: error.status, body: error.body() });
        return;
      }
      process.stderr.write(`request failed: ${String(error)}\n`);
      sendJson(response, { status: 500, body: { error: 'invalid' } });
    }
    return;
  }
  const file = staticFile(url.pathname);
  if (file) {
    sendFile(response, file);
    return;
  }
  if (isPageRoute(url.pathname)) {
    const index = path.join(publicDir, 'index.html');
    if (existsSync(index)) {
      sendFile(response, index);
      return;
    }
  }
  sendJson(response, { status: 404, body: notFound().body() });
}

export function createHttpServer(): ReturnType<typeof createServer> {
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  server.on('upgrade', (request, socket, head) => {
    handleUpgrade(request, socket, head);
  });
  return server;
}
