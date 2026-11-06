import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { DatabaseBusyError } from './db.ts';
import { seedIfNeeded } from './seed.ts';
import { ApiError, databaseBusy, forbidden, notFound, tooLarge, unsupportedMediaType } from './http/errors.ts';
import type { ApiResult, RequestContext } from './http/context.ts';
import { withIdempotency } from './http/idempotency.ts';
import { matchRoute } from './http/router.ts';
import { sessionFor } from './http/session.ts';
import { MAX_UPLOAD_BYTES } from './domain/uploads.ts';
import { startMailRetries } from './providers/mailQueue.ts';
import { startPendingDeletes } from './api/documents.ts';

const MAX_JSON_BYTES = 16_384;
const publicRoot = path.resolve(import.meta.dirname, '../public');

const ASSET_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

function readBody(request: http.IncomingMessage, limit: number): Promise<Buffer | 'too-large'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overLimit = false;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        overLimit = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(overLimit ? 'too-large' : Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function sendJson(response: http.ServerResponse, result: ApiResult): void {
  const headers: Record<string, string | string[]> = {
    'Cache-Control': 'no-store',
    ...(result.headers ?? {}),
  };
  if (result.cookies && result.cookies.length > 0) headers['Set-Cookie'] = result.cookies;
  if (result.rawBody) {
    headers['Content-Length'] = String(result.rawBody.length);
    response.writeHead(result.status, headers);
    response.end(result.rawBody);
    return;
  }
  if (result.status === 204 || result.body === undefined) {
    response.writeHead(result.status, headers);
    response.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(result.body), 'utf8');
  headers['Content-Type'] = 'application/json; charset=utf-8';
  headers['Content-Length'] = String(payload.length);
  response.writeHead(result.status, headers);
  response.end(payload);
}

function sendError(response: http.ServerResponse, error: ApiError): void {
  sendJson(response, { status: error.status, body: error.body(), headers: error.headers });
}

function sameOrigin(request: http.IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined || origin === 'null') return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function jsonContentTypeOk(contentType: string | undefined): boolean {
  const base = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return base === 'application/json';
}

async function handleApi(request: http.IncomingMessage, response: http.ServerResponse, url: URL): Promise<void> {
  const method = request.method ?? 'GET';
  const match = matchRoute(method, url.pathname);
  const limit = match?.route.body === 'raw' ? MAX_UPLOAD_BYTES : MAX_JSON_BYTES;
  const body = await readBody(request, limit);
  if (body === 'too-large') {
    sendError(response, tooLarge());
    return;
  }
  if (!match) {
    sendError(response, notFound());
    return;
  }
  if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(request)) {
    sendError(response, forbidden());
    return;
  }
  if (match.route.body === 'json' && body.length > 0 && !jsonContentTypeOk(request.headers['content-type'])) {
    sendError(response, unsupportedMediaType('Send this as application/json.'));
    return;
  }
  const ctx: RequestContext = {
    method,
    url,
    params: match.params,
    rawBody: body,
    headers: request.headers,
    session: match.route.auth === 'public' ? sessionFor(request.headers.cookie) : null,
    now: Date.now(),
  };
  if (match.route.auth === 'session') {
    ctx.session = sessionFor(request.headers.cookie);
    if (!ctx.session) {
      sendError(response, new ApiError(401, 'unauthenticated', 'Sign in to use this.'));
      return;
    }
  }
  const mode = typeof match.route.idempotency === 'function' ? match.route.idempotency(ctx) : match.route.idempotency;
  const run = async (): Promise<ApiResult> => match.route.handler(ctx);
  try {
    const result = mode === 'none' ? await run() : await withIdempotency(ctx, mode, run);
    sendJson(response, result);
  } catch (error) {
    if (error instanceof ApiError) {
      sendError(response, error);
      return;
    }
    if (error instanceof DatabaseBusyError) {
      sendError(response, databaseBusy());
      return;
    }
    console.error('request failed:', error instanceof Error ? error.message : 'unknown');
    sendJson(response, {
      status: 500,
      body: { error: { code: 'internal', message: 'Something went wrong.' } },
    });
  }
}

function serveAsset(response: http.ServerResponse, filePath: string): void {
  const extension = path.extname(filePath);
  response.writeHead(200, {
    'Content-Type': ASSET_TYPES[extension] ?? 'application/octet-stream',
    'Content-Length': String(statSync(filePath).size),
    'Cache-Control': 'max-age=0, must-revalidate',
  });
  createReadStream(filePath).pipe(response);
}

function servePage(response: http.ServerResponse, status: number): void {
  const indexPath = path.join(publicRoot, 'index.html');
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': String(statSync(indexPath).size),
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(indexPath).pipe(response);
}

function handleStatic(request: http.IncomingMessage, response: http.ServerResponse, url: URL): void {
  const relative = url.pathname.replace(/^\/+/, '');
  const candidate = path.resolve(publicRoot, relative);
  const insidePublic = candidate === publicRoot || candidate.startsWith(`${publicRoot}${path.sep}`);
  if (
    insidePublic &&
    relative.length > 0 &&
    relative !== 'index.html' &&
    existsSync(candidate) &&
    statSync(candidate).isFile() &&
    ASSET_TYPES[path.extname(candidate)] !== undefined
  ) {
    serveAsset(response, candidate);
    return;
  }
  servePage(response, url.pathname.includes('.') ? 404 : 200);
}

function start(): void {
  seedIfNeeded();
  startMailRetries();
  startPendingDeletes();
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      void handleApi(request, response, url);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendError(response, notFound());
      return;
    }
    handleStatic(request, response, url);
  });
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`tally split listening on ${config.port}`);
  });
}

start();
