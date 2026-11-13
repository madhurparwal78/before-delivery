import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config';
import {
  ApiError,
  crossOrigin,
  internalError,
  invalid,
  notFound,
  payloadTooLarge,
  starting,
  unauthenticated,
  unsupportedMediaType,
} from './errors';
import { memberForToken, SESSION_COOKIE } from './auth';
import type { MemberRow } from './repo';
import { isReady } from './readiness';
import { routes, type Reply } from './routes';

/** What every handler is given. */
export interface RequestContext {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  headers: IncomingMessage['headers'];
}

/** What a handler behind the session check is given: the member and the session token they came with. */
export interface SignedInContext extends RequestContext {
  member: MemberRow;
  token: string;
}

const CLIENT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'client');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};
const WRITES = new Set(['POST', 'PATCH', 'DELETE']);

async function readBody(req: IncomingMessage): Promise<{ raw: Buffer; tooLarge: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size <= config.bodyLimitBytes) chunks.push(chunk as Buffer);
  }
  return { raw: Buffer.concat(chunks), tooLarge: size > config.bodyLimitBytes };
}

function send(res: ServerResponse, reply: Reply): void {
  const raw = reply.raw ?? (reply.body === undefined ? undefined : Buffer.from(JSON.stringify(reply.body)));
  res.writeHead(reply.status, {
    ...(raw ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': raw.length } : {}),
    'Cache-Control': 'no-store',
    ...reply.headers,
  });
  res.end(raw);
}

function sendError(res: ServerResponse, error: ApiError): void {
  send(res, { status: error.status, body: error.body() });
}

function cookieOf(req: IncomingMessage, name: string): string | undefined {
  const pairs = (req.headers.cookie ?? '').split(';').map((p) => p.trim().split('='));
  return pairs.find(([k]) => k === name)?.[1];
}

/** The origin header, when present, must name the host the request was sent to. */
function isCrossOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const relative = pathname === '/' ? 'index.html' : normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '');
  const file = resolve(join(CLIENT_ROOT, relative));
  const type = TYPES[extname(file)];
  if (!file.startsWith(CLIENT_ROOT + sep) || !type || relative.split(sep).some((part) => part.startsWith('.'))) {
    sendError(res, notFound());
    return;
  }
  try {
    const content = await readFile(file);
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': content.length,
      'Cache-Control': relative === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(content);
  } catch {
    sendError(res, notFound());
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';
  if (!url.pathname.startsWith('/api')) {
    if (method !== 'GET' && method !== 'HEAD') return sendError(res, notFound());
    return serveStatic(url.pathname, res);
  }
  if (WRITES.has(method) && isCrossOrigin(req)) return sendError(res, crossOrigin());

  const { raw, tooLarge } = await readBody(req);
  if (raw.length > 0 || tooLarge) {
    if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return sendError(res, unsupportedMediaType());
    if (tooLarge) return sendError(res, payloadTooLarge());
  }

  const route = routes.find((r) => r.method === method && r.pattern.test(url.pathname));
  if (!route) return sendError(res, notFound());
  if (!isReady() && route.path !== '/api/health') return sendError(res, starting());

  let body: unknown;
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return sendError(res, invalid({}));
    }
  }
  const context: RequestContext = { params: route.pattern.exec(url.pathname)?.groups ?? {}, query: url.searchParams, body, headers: req.headers };
  if (route.public) return send(res, await route.handler(context));
  const token = cookieOf(req, SESSION_COOKIE);
  const member = await memberForToken(token);
  if (!member || !token) return sendError(res, unauthenticated());
  send(res, await route.handler({ ...context, member, token }));
}

export function startServer(): Server {
  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (error instanceof ApiError) return sendError(res, error);
      console.error(error);
      sendError(res, internalError());
    });
  });
  server.listen(config.port, '0.0.0.0');
  return server;
}
