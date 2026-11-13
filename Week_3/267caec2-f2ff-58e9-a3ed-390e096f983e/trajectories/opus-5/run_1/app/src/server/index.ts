import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { config } from './config';
import { applySchema, pool } from './db';
import { fileTooLarge, forbidden, notFound, payloadTooLarge, unsupportedMediaType } from './copy';
import { HttpError } from './http/errors';
import { actorForToken, readCookie, SESSION_COOKIE } from './http/session';
import { json, match, type Ctx, type Reply, type Route } from './http/router';
import { accountRoutes } from './routes/accounts';
import { directorRoutes } from './routes/director';
import { entryRoutes } from './routes/entries';
import { jurorRoutes } from './routes/juror';
import { programRoutes } from './routes/programs';
import { publicRoutes } from './routes/public';
import { applySeed } from './seed';
import { startWorkers } from './workers';

const routes: Route[] = [
  ...publicRoutes,
  ...accountRoutes,
  ...programRoutes,
  ...jurorRoutes,
  ...directorRoutes,
  ...entryRoutes,
];

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const JSON_LIMIT = 65_536;
const MULTIPART_LIMIT = 8_100_000;
const UPLOAD_PATH = /^\/api\/entries\/[^/]+\/assets$/;

const webRoot = path.join(__dirname, '..', 'web');
const STATIC_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

let ready = false;

function readBody(request: http.IncomingMessage, limit: number): Promise<Buffer | 'too_large'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overflow = false;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        overflow = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(overflow ? 'too_large' : Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function send(response: http.ServerResponse, reply: Reply): void {
  if (reply.kind === 'empty') {
    response.writeHead(reply.status);
    response.end();
    return;
  }
  if (reply.kind === 'bytes') {
    response.writeHead(reply.status, {
      'content-type': reply.contentType,
      'content-length': reply.body.length,
      'x-content-type-options': 'nosniff',
    });
    response.end(reply.body);
    return;
  }
  const body = Buffer.from(JSON.stringify(reply.body), 'utf8');
  response.writeHead(reply.status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
  });
  response.end(body);
}

function sameOrigin(request: http.IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined || origin === 'null') return true;
  const host = request.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function serveStatic(url: URL, response: http.ServerResponse): Promise<void> {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const extension = path.extname(requested);
  const target = path.join(webRoot, path.normalize(requested).replace(/^(\.\.[/\\])+/, ''));
  if (extension !== '' && target.startsWith(webRoot)) {
    try {
      const file = await readFile(target);
      response.writeHead(200, {
        'content-type': STATIC_TYPES[extension] ?? 'application/octet-stream',
        'content-length': file.length,
      });
      response.end(file);
      return;
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
  }
  const page = await readFile(path.join(webRoot, 'index.html'));
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': page.length });
  response.end(page);
}

async function handleApi(request: http.IncomingMessage, response: http.ServerResponse, url: URL): Promise<void> {
  const method = request.method ?? 'GET';
  const contentType = String(request.headers['content-type'] ?? '');
  const isMultipart = contentType.startsWith('multipart/form-data');

  if (WRITE_METHODS.has(method) && !sameOrigin(request)) throw forbidden();

  const raw = await readBody(request, isMultipart ? MULTIPART_LIMIT : JSON_LIMIT);
  if (raw === 'too_large') throw isMultipart ? fileTooLarge() : payloadTooLarge();

  if (WRITE_METHODS.has(method) && raw.length > 0) {
    const uploadEndpoint = method === 'POST' && UPLOAD_PATH.test(url.pathname);
    const acceptable = uploadEndpoint ? isMultipart : contentType.startsWith('application/json');
    if (!acceptable) throw unsupportedMediaType();
  }

  const found = match(routes, method, url.pathname);
  if (found === null) throw notFound();

  let body: Record<string, unknown> = {};
  if (!isMultipart && raw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(raw.toString('utf8'));
      if (parsed !== null && typeof parsed === 'object') body = parsed as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  const token = readCookie(request.headers.cookie, SESSION_COOKIE);
  const ctx: Ctx = {
    method,
    path: url.pathname,
    query: url.searchParams,
    params: found.params,
    headers: request.headers,
    body,
    raw,
    res: response,
    token,
    actor: await actorForToken(token),
  };
  send(response, await found.route.handler(ctx));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (!url.pathname.startsWith('/api/')) {
    void serveStatic(url, response).catch(() => {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Error');
    });
    return;
  }
  if (url.pathname === '/api/health' && !ready) {
    send(response, json(503, { status: 'starting' }));
    return;
  }
  void handleApi(request, response, url).catch((error: unknown) => {
    if (error instanceof HttpError) {
      send(response, { kind: 'json', status: error.status, body: error.body });
      return;
    }
    process.stderr.write(`request failed: ${String(error)}\n`);
    send(response, json(500, { error: 'internal_error', message: 'The desk hit an unexpected error.' }));
  });
});

async function prepare(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      await applySeed();
      ready = true;
      startWorkers();
      return;
    } catch (error) {
      process.stderr.write(`waiting for Postgres: ${String(error)}\n`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`Cutline Jury Desk listening on ${config.port}\n`);
  void prepare();
});

process.on('SIGTERM', () => {
  server.close();
  void pool.end();
});


