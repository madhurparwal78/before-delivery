import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { withTransaction } from './db.js';
import { applySchemaAndSeed } from './seed.js';
import { matchApiRoute } from './api.js';
import { parseCookies, resolveSession, SESSION_COOKIE } from './auth.js';
import {
  ApiError,
  crossOrigin,
  notFound,
  payloadTooLarge,
  unsupportedMediaType,
} from './http/errors.js';
import type { RequestContext } from './http/context.js';
import { decidePage, shell } from './pages.js';
import { markReady } from './routes/session.js';
import { startStorageChecks } from './services/storage.js';
import { startMailWorker } from './services/mail.js';
import { startHoldSweep } from './holds.js';

const MAX_BODY_BYTES = 65536;
const publicDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const STATIC_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

const STATIC_PATHS = new Set(['/app.js', '/app.css', '/coastline.json']);

function isWrite(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH';
}

/** Reads the body, draining anything over the limit so the oversize answer still goes out. */
async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  let oversize = false;
  for await (const chunk of request) {
    const piece = chunk as Buffer;
    size += piece.length;
    if (size > MAX_BODY_BYTES) {
      oversize = true;
      chunks.length = 0;
    } else {
      chunks.push(piece);
    }
  }
  if (oversize) throw payloadTooLarge();
  return Buffer.concat(chunks);
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  if (status === 204) {
    response.writeHead(204, headers);
    response.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(payload);
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  const payload = Buffer.from(html, 'utf8');
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
  });
  response.end(payload);
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<boolean> {
  const isFont = pathname.startsWith('/fonts/') && pathname.endsWith('.woff2');
  if (!STATIC_PATHS.has(pathname) && !isFont) return false;

  const resolved = join(publicDirectory, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!resolved.startsWith(publicDirectory)) return false;

  const extension = pathname.slice(pathname.lastIndexOf('.'));
  const bytes = await readFile(resolved).catch(() => null);
  if (!bytes) return false;

  response.writeHead(200, {
    'content-type': STATIC_TYPES[extension] ?? 'application/octet-stream',
    'content-length': String(bytes.length),
    'cache-control': isFont ? 'public, max-age=604800' : 'no-cache',
  });
  response.end(bytes);
  return true;
}

function checkBoundary(request: IncomingMessage, body: Buffer): void {
  const method = request.method ?? 'GET';
  if (isWrite(method)) {
    const origin = request.headers.origin;
    if (typeof origin === 'string' && origin !== 'null') {
      const host = request.headers.host ?? '';
      const parsed = ((): URL | null => {
        try {
          return new URL(origin);
        } catch {
          return null;
        }
      })();
      if (!parsed || parsed.host !== host) throw crossOrigin();
    }
  }
  if (body.length > MAX_BODY_BYTES) throw payloadTooLarge();
  if (isWrite(method) && body.length > 0) {
    const contentType = request.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().includes('application/json')) throw unsupportedMediaType();
  }
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  let body: Buffer;
  try {
    body = await readBody(request);
    checkBoundary(request, body);
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(response, error.status, error.body(), error.headers);
      return;
    }
    sendJson(response, 400, { code: 'validation_failed', errors: { body: 'Send valid JSON.' } });
    return;
  }

  if (pathname.startsWith('/api')) {
    const matched = matchApiRoute(method, pathname);
    if (!matched) {
      sendJson(response, 404, notFound().body());
      return;
    }

    let parsed: unknown;
    if (body.length > 0) {
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch {
        sendJson(response, 422, {
          code: 'validation_failed',
          errors: { body: 'Send valid JSON.' },
        });
        return;
      }
    }

    const cookies = parseCookies(request.headers.cookie);
    const context: RequestContext = {
      request,
      response,
      method,
      url,
      params: matched.params,
      body: parsed,
      session: await resolveSession(cookies[SESSION_COOKIE] ?? null),
    };

    try {
      const result = await matched.handler(context);
      if (result.kind === 'json') {
        sendJson(response, result.status, result.body, result.headers ?? {});
      } else {
        response.writeHead(result.status, {
          'content-type': result.contentType,
          'content-length': String(result.body.length),
          'cache-control': 'no-store',
          ...(result.headers ?? {}),
        });
        response.end(result.body);
      }
    } catch (error) {
      if (error instanceof ApiError) {
        sendJson(response, error.status, error.body(), error.headers);
        return;
      }
      process.stderr.write(`${String(error)}\n`);
      sendJson(response, 500, { code: 'server_error' });
    }
    return;
  }

  if (method === 'GET' && (await serveStatic(pathname, response))) return;

  const cookies = parseCookies(request.headers.cookie);
  const session = await resolveSession(cookies[SESSION_COOKIE] ?? null);

  if (method !== 'GET' && method !== 'HEAD') {
    sendHtml(response, 404, shell(true, session !== null));
    return;
  }

  const decision = await decidePage(pathname, url.search, session);
  if (decision.kind === 'redirect') {
    response.writeHead(302, { location: decision.location, 'cache-control': 'no-store' });
    response.end();
    return;
  }
  const notFoundPage = decision.kind === 'not-found';
  sendHtml(response, notFoundPage ? 404 : 200, shell(notFoundPage, session !== null));
}

async function main(): Promise<void> {
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { code: 'server_error' });
      else response.end();
    });
  });

  server.listen(config.port, '0.0.0.0');
  startStorageChecks();

  await withTransaction(applySchemaAndSeed);
  markReady();
  startHoldSweep();
  startMailWorker();
}

void main();
